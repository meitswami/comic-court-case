// Authentication service (server-side, plain JS)
// The API runs under plain Node, which cannot import the `.ts` files in
// src/, so this is the canonical server-side copy that all Express routes
// import from.
//
// Behaviour mirrors src/services/auth.ts.

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { queryOne, insert, generateUUID } from './mysql.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function assertJwtSecret() {
  if (!JWT_SECRET || JWT_SECRET === 'your-secret-key-change-in-production') {
    throw new Error(
      'JWT_SECRET is not set. Configure JWT_SECRET in your environment variables.'
    );
  }
}

// `claims` carries extra flags such as { tfa: true } for an admin who has
// passed the authenticator check.
function generateToken(userId, claims = {}) {
  assertJwtSecret();
  return jwt.sign({ ...claims, userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function createSession(user, token) {
  const decoded = jwt.decode(token);
  const expiresIn = decoded && decoded.exp
    ? decoded.exp - Math.floor(Date.now() / 1000)
    : 604800;

  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: expiresIn,
    user,
  };
}

export async function signUp(email, password, metadata) {
  try {
    const existingUser = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return { data: null, error: new Error('User already exists') };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = generateUUID();

    await insert('users', {
      id: userId,
      email,
      password_hash: passwordHash,
      email_verified: false,
      raw_user_meta_data: metadata ? JSON.stringify(metadata) : null,
    });

    await insert('profiles', {
      id: generateUUID(),
      user_id: userId,
      display_name: (metadata && metadata.display_name) || null,
      preferred_language: 'en',
    });

    await insert('user_roles', {
      id: generateUUID(),
      user_id: userId,
      role: 'user',
    });

    await insert('user_wallets', {
      id: generateUUID(),
      user_id: userId,
      balance: 0.0,
      currency: 'INR',
    });

    const user = await queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return { data: null, error: new Error('Failed to create user') };
    }

    const token = generateToken(userId);
    return { data: { user, session: createSession(user, token) }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function signIn(email, password) {
  try {
    const userWithPassword = await queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at, password_hash FROM users WHERE email = ?',
      [email]
    );

    if (!userWithPassword) {
      return { data: null, error: new Error('Invalid email or password') };
    }

    const isValid = await bcrypt.compare(password, userWithPassword.password_hash);
    if (!isValid) {
      return { data: null, error: new Error('Invalid email or password') };
    }

    const user = {
      id: userWithPassword.id,
      email: userWithPassword.email,
      email_verified: userWithPassword.email_verified,
      raw_user_meta_data: userWithPassword.raw_user_meta_data
        ? JSON.parse(userWithPassword.raw_user_meta_data)
        : null,
      created_at: userWithPassword.created_at,
      updated_at: userWithPassword.updated_at,
    };

    // Admin accounts do not get a session from the password alone. They get a
    // short-lived challenge that must be exchanged, together with an
    // authenticator code, at /api/authenticator/verify (or /setup on first use).
    // Normal users are never asked for a code.
    if (await isAdmin(user.id)) {
      return {
        data: {
          requires2FA: true,
          setupRequired: !(await isAuthenticatorEnabled()),
          challengeToken: createChallengeToken(user.id),
          email: user.email,
        },
        error: null,
      };
    }

    const token = generateToken(user.id);
    return { data: { user, session: createSession(user, token) }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export async function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Challenge tokens (purpose: '2fa') are not sessions.
    if (!decoded || !decoded.userId || decoded.purpose) return null;
    return queryOne(
      'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
      [decoded.userId]
    );
  } catch (error) {
    return null;
  }
}

export async function isAdmin(userId) {
  const role = await queryOne(
    'SELECT role FROM user_roles WHERE user_id = ? AND role = ?',
    [userId, 'admin']
  );
  return !!role;
}

export async function getUserById(userId) {
  return queryOne(
    'SELECT id, email, email_verified, raw_user_meta_data, created_at, updated_at FROM users WHERE id = ?',
    [userId]
  );
}

// ---------------------------------------------------------------------------
// Admin two-factor (authenticator) helpers
// ---------------------------------------------------------------------------

const CHALLENGE_PURPOSE = '2fa';
const CHALLENGE_EXPIRES_IN = '10m';

export async function isAuthenticatorEnabled() {
  const record = await queryOne(
    'SELECT id FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
  );
  return !!record;
}

// Issued after a correct admin password; only valid for the authenticator routes.
export function createChallengeToken(userId) {
  assertJwtSecret();
  return jwt.sign({ userId, purpose: CHALLENGE_PURPOSE }, JWT_SECRET, {
    expiresIn: CHALLENGE_EXPIRES_IN,
  });
}

// Returns the user id the challenge was issued for, or null.
export function verifyChallengeToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.purpose !== CHALLENGE_PURPOSE || !decoded.userId) return null;
    return decoded.userId;
  } catch (error) {
    return null;
  }
}

// Builds the same { user, session } payload signIn returns.
export async function issueSession(userId, claims = {}) {
  const row = await getUserById(userId);
  if (!row) return null;

  let meta = row.raw_user_meta_data || null;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch (error) {
      meta = null;
    }
  }

  const user = { ...row, raw_user_meta_data: meta };
  const token = generateToken(userId, claims);
  return { user, session: createSession(user, token) };
}

// Admin role AND (authenticator passed, or no authenticator configured yet).
export async function hasAdminAccess(userId, tfaVerified) {
  if (!(await isAdmin(userId))) return false;
  if (tfaVerified) return true;
  return !(await isAuthenticatorEnabled());
}
