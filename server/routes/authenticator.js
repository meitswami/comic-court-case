// Master Authenticator 2FA Routes
// Single owner access control for landing page - no email, no user dependency

import express from 'express';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { query, queryOne, insert, update, generateUUID } from '../lib/mysql.js';

const router = express.Router();

// Check if authenticator is set up
router.get('/status', async (req, res) => {
  try {
    const secretRecord = await queryOne(
      'SELECT * FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    
    res.json({
      isSetup: !!secretRecord,
      ownerName: secretRecord?.owner_name || null
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: error.message || 'Failed to check status' });
  }
});

// Generate QR code for initial setup (no auth required - first time only)
router.post('/setup', async (req, res) => {
  try {
    // Check if already set up
    const existingSecret = await queryOne(
      'SELECT * FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    
    if (existingSecret && existingSecret.is_enabled) {
      return res.status(400).json({ 
        error: 'Authenticator is already set up',
        secretExists: true 
      });
    }
    
    const { ownerName } = req.body;
    
    if (!ownerName || !ownerName.trim()) {
      return res.status(400).json({ error: 'Owner name is required' });
    }
    
    // Generate a new secret
    const secret = speakeasy.generateSecret({
      name: `eNyayaSetu Owner`,
      issuer: 'eNyayaSetu',
      length: 32
    });
    
    // Generate backup codes (8 codes)
    const backupCodes = Array.from({ length: 8 }, () => 
      Math.random().toString(36).substring(2, 10).toUpperCase()
    );
    
    // Store secret (initially not enabled until verified)
    if (existingSecret && !existingSecret.is_enabled) {
      await update(
        'master_authenticator_secret',
        {
          owner_name: ownerName.trim(),
          secret: secret.base32,
          backup_codes: JSON.stringify(backupCodes),
          is_enabled: false,
          updated_at: new Date()
        },
        { id: existingSecret.id }
      );
    } else {
      await insert('master_authenticator_secret', {
        id: generateUUID(),
        owner_name: ownerName.trim(),
        secret: secret.base32,
        backup_codes: JSON.stringify(backupCodes),
        is_enabled: false
      });
    }
    
    // Generate QR code data URL
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    
    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
      backupCodes: backupCodes
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate QR code' });
  }
});

// Verify and enable 2FA (during setup)
router.post('/verify-setup', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Get the secret
    const secretRecord = await queryOne(
      'SELECT * FROM master_authenticator_secret ORDER BY created_at DESC LIMIT 1'
    );
    
    if (!secretRecord) {
      return res.status(404).json({ error: 'No authenticator secret found. Please set up first.' });
    }
    
    // Verify token
    const verified = speakeasy.totp.verify({
      secret: secretRecord.secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) of variance
    });
    
    if (!verified) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    
    // Enable 2FA and mark setup as completed
    await update(
      'master_authenticator_secret',
      {
        is_enabled: true,
        setup_completed_at: new Date()
      },
      { id: secretRecord.id }
    );
    
    res.json({ 
      success: true, 
      message: 'Authenticator successfully verified and enabled',
      ownerName: secretRecord.owner_name
    });
  } catch (error) {
    console.error('Verify setup error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify token' });
  }
});

// Verify OTP and log attempt
router.post('/verify', async (req, res) => {
  try {
    const { token, fullName } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full Name is required' });
    }
    
    // Get the secret
    const secretRecord = await queryOne(
      'SELECT * FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
    );
    
    if (!secretRecord) {
      // Log failed attempt
      await insert('authenticator_access_attempts', {
        id: generateUUID(),
        full_name: fullName.trim(),
        otp_code: token,
        is_successful: false,
        ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        user_agent: req.headers['user-agent']
      });
      
      return res.status(401).json({ error: 'Authenticator not set up' });
    }
    
    // Verify token
    const verified = speakeasy.totp.verify({
      secret: secretRecord.secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) of variance
    });
    
    // Check backup codes if token verification fails
    let backupCodeUsed = false;
    if (!verified && secretRecord.backup_codes) {
      const backupCodes = JSON.parse(secretRecord.backup_codes || '[]');
      const codeIndex = backupCodes.indexOf(token.toUpperCase());
      
      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await update(
          'master_authenticator_secret',
          { backup_codes: JSON.stringify(backupCodes) },
          { id: secretRecord.id }
        );
        backupCodeUsed = true;
      }
    }
    
    const isSuccessful = verified || backupCodeUsed;
    
    // Log attempt
    await insert('authenticator_access_attempts', {
      id: generateUUID(),
      full_name: fullName.trim(),
      otp_code: token,
      is_successful: isSuccessful,
      ip_address: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      user_agent: req.headers['user-agent']
    });
    
    if (!isSuccessful) {
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }
    
    res.json({ 
      success: true, 
      message: 'Authentication successful',
      ownerName: secretRecord.owner_name
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: error.message || 'Failed to verify token' });
  }
});

// Get access attempts (for admin/debugging)
router.get('/attempts', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const attempts = await query(
      `SELECT * FROM authenticator_access_attempts 
       ORDER BY attempted_at DESC 
       LIMIT ?`,
      [parseInt(limit)]
    );
    
    res.json({ attempts });
  } catch (error) {
    console.error('Get attempts error:', error);
    res.status(500).json({ error: error.message || 'Failed to get attempts' });
  }
});

export default router;
