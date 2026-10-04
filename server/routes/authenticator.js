// Admin Two-Factor Authentication (TOTP) Routes
//
// The authenticator code is required ONLY when an admin signs in. Normal
// users never reach these routes.
//
// Flow:
//   1. POST /api/auth/signin with an admin's email + password returns
//      { requires2FA: true, setupRequired, challengeToken } instead of a session.
//   2. The client exchanges that challenge plus a 6-digit code here:
//        - POST /verify                       authenticator already configured
//        - POST /setup, then /verify-setup    first-time configuration
//      A correct code returns the normal { user, session } payload. The session
//      token carries `tfa: true`, which admin-only checks on the server require.
//
// One authenticator secret is shared by all admin accounts
// (table: master_authenticator_secret).

import express from 'express';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { query, queryOne, insert, update, generateUUID } from '../lib/mysql.js';
import {
  verifyChallengeToken,
  issueSession,
  isAdmin,
  hasAdminAccess,
} from '../lib/auth.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Resolves the challenge token issued by /api/auth/signin to an admin user.
async function requireChallenge(req, res, next) {
  try {
    const userId = verifyChallengeToken(req.body && req.body.challengeToken);
    if (!userId) {
      return res.status(401).json({
        error: 'Your sign-in has expired. Please sign in again.',
        challengeExpired: true,
      });
    }

    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const user = await queryOne('SELECT id, email FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.challengeUser = user;
    next();
  } catch (error) {
    console.error('[Authenticator] Challenge check error:', error);
    res.status(500).json({ error: 'Failed to check sign-in' });
  }
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || (req.socket && req.socket.remoteAddress) || '';
  return ip.substring(0, 45);
}

// The entered code is deliberately not stored.
async function logAttempt(req, user, isSuccessful) {
  try {
    await insert('authenticator_access_attempts', {
      id: generateUUID(),
      full_name: user.email,
      otp_code: null,
      is_successful: isSuccessful,
      ip_address: clientIp(req),
      user_agent: req.headers['user-agent'] || null,
    });
  } catch (error) {
    console.error('[Authenticator] Failed to log attempt:', error.message);
  }
}

async function recentFailures(user) {
  const row = await queryOne(
    `SELECT COUNT(*) AS failures FROM authenticator_access_attempts
     WHERE full_name = ? AND is_successful = FALSE
       AND attempted_at > (NOW() - INTERVAL ${LOCKOUT_MINUTES} MINUTE)`,
    [user.email]
  );
  return Number(row && row.failures) || 0;
}

async function isLockedOut(req, res) {
  if ((await recentFailures(req.challengeUser)) >= MAX_FAILED_ATTEMPTS) {
    res.status(429).json({
      error: `Too many wrong codes. Try again in ${LOCKOUT_MINUTES} minutes.`,
    });
    return true;
  }
  return false;
}

function normaliseCode(value) {
  return String(value || '').replace(/\s+/g, '');
}

function verifyTotp(secret, code) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 2, // allow 2 time steps (60 seconds) of clock drift
  });
}

// backup_codes is a JSON column: MySQL returns it parsed, MariaDB as a string.
function parseBackupCodes(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

// First-time setup: generate the secret and QR code.
router.post('/setup', requireChallenge, async (req, res) => {
  try {
    const enabled = await queryOne(
      'SELECT id FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    if (enabled) {
      return res.status(400).json({
        error: 'Authenticator is already set up',
        secretExists: true,
      });
    }

    const secret = speakeasy.generateSecret({
      name: 'eNyayaSetu Admin',
      issuer: 'eNyayaSetu',
      length: 32,
    });

    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    // Reuse an unfinished setup row instead of piling up new ones.
    const pending = await queryOne(
      'SELECT id FROM master_authenticator_secret WHERE is_enabled = FALSE ORDER BY created_at DESC LIMIT 1'
    );

    if (pending) {
      await update(
        'master_authenticator_secret',
        {
          owner_name: req.challengeUser.email,
          secret: secret.base32,
          backup_codes: JSON.stringify(backupCodes),
        },
        { id: pending.id }
      );
    } else {
      await insert('master_authenticator_secret', {
        id: generateUUID(),
        owner_name: req.challengeUser.email,
        secret: secret.base32,
        backup_codes: JSON.stringify(backupCodes),
        is_enabled: false,
      });
    }

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      qrCode,
      manualEntryKey: secret.base32,
      backupCodes,
    });
  } catch (error) {
    console.error('[Authenticator] Setup error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate QR code' });
  }
});

// First-time setup: confirm the first code, enable 2FA, sign the admin in.
router.post('/verify-setup', requireChallenge, async (req, res) => {
  try {
    const code = normaliseCode(req.body.code);
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    if (await isLockedOut(req, res)) return;

    const enabled = await queryOne(
      'SELECT id FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    if (enabled) {
      return res.status(400).json({
        error: 'Authenticator is already set up',
        secretExists: true,
      });
    }

    const pending = await queryOne(
      'SELECT * FROM master_authenticator_secret WHERE is_enabled = FALSE ORDER BY created_at DESC LIMIT 1'
    );
    if (!pending) {
      return res.status(404).json({ error: 'No authenticator secret found. Please set up first.' });
    }

    if (!verifyTotp(pending.secret, code)) {
      await logAttempt(req, req.challengeUser, false);
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }

    await update(
      'master_authenticator_secret',
      { is_enabled: true, setup_completed_at: new Date() },
      { id: pending.id }
    );
    await logAttempt(req, req.challengeUser, true);

    const sessionData = await issueSession(req.challengeUser.id, { tfa: true });
    res.json({ success: true, ...sessionData });
  } catch (error) {
    console.error('[Authenticator] Verify setup error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify code' });
  }
});

// Admin sign-in: exchange challenge + code for a session.
router.post('/verify', requireChallenge, async (req, res) => {
  try {
    const code = normaliseCode(req.body.code);
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    if (await isLockedOut(req, res)) return;

    const secretRecord = await queryOne(
      'SELECT * FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    if (!secretRecord) {
      return res.status(400).json({
        error: 'Authenticator is not set up',
        setupRequired: true,
      });
    }

    let isSuccessful = verifyTotp(secretRecord.secret, code);

    // Fall back to the one-time backup codes.
    if (!isSuccessful) {
      const backupCodes = parseBackupCodes(secretRecord.backup_codes);
      const codeIndex = backupCodes.indexOf(code.toUpperCase());
      if (codeIndex !== -1) {
        backupCodes.splice(codeIndex, 1);
        await update(
          'master_authenticator_secret',
          { backup_codes: JSON.stringify(backupCodes) },
          { id: secretRecord.id }
        );
        isSuccessful = true;
      }
    }

    await logAttempt(req, req.challengeUser, isSuccessful);

    if (!isSuccessful) {
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }

    const sessionData = await issueSession(req.challengeUser.id, { tfa: true });
    res.json({ success: true, ...sessionData });
  } catch (error) {
    console.error('[Authenticator] Verify error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify code' });
  }
});

// Access attempts log - admins only.
router.get('/attempts', authenticate, async (req, res) => {
  try {
    if (!(await hasAdminAccess(req.userId, req.tfaVerified))) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);

    const attempts = await query(
      `SELECT id, full_name, is_successful, ip_address, user_agent, attempted_at
       FROM authenticator_access_attempts
       ORDER BY attempted_at DESC
       LIMIT ${limit}`
    );

    res.json({ attempts });
  } catch (error) {
    console.error('[Authenticator] Get attempts error:', error);
    res.status(500).json({ error: error.message || 'Failed to get attempts' });
  }
});

export default router;
