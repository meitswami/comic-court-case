// Authentication Middleware
// Validates JWT tokens for protected routes

import jwt from 'jsonwebtoken';
import { queryOne } from '../lib/mysql.js';

const PLACEHOLDER_SECRET = 'your-secret-key-change-in-production';

// Fail closed: never verify tokens against a missing or well-known secret,
// otherwise anyone could forge a session token.
function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  return secret && secret !== PLACEHOLDER_SECRET ? secret : null;
}

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const secret = jwtSecret();
    if (!secret) {
      console.error('[Auth] JWT_SECRET is not configured; refusing to verify tokens.');
      return res.status(500).json({ error: 'Server authentication is not configured' });
    }

    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
      const userId = decoded.userId;

      if (!userId) {
        console.error('[Auth] Token decoded but no userId found:', decoded);
        return res.status(401).json({ error: 'Invalid token: no user ID' });
      }

      // A 2FA challenge token is not a session and cannot be used as one.
      if (decoded.purpose) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      // Get user from database
      const user = await queryOne(
        'SELECT id, email, email_verified FROM users WHERE id = ?',
        [userId]
      );

      if (!user) {
        console.error('[Auth] User not found for userId:', userId);
        return res.status(401).json({ error: 'User not found' });
      }

      // Attach user to request
      req.user = user;
      req.userId = userId;
      // True only for an admin session issued after the authenticator check.
      req.tfaVerified = decoded.tfa === true;
      next();
    } catch (error) {
      console.error('[Auth] Token verification failed:', error.message);
      console.error('[Auth] Token (first 20 chars):', token.substring(0, 20));
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('[Auth] Authentication error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

export async function requireAdmin(req, res, next) {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const role = await queryOne(
      'SELECT role FROM user_roles WHERE user_id = ? AND role = ?',
      [req.userId, 'admin']
    );

    if (!role) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Once the authenticator is configured, admin routes need a session that
    // passed the authenticator check at sign-in.
    if (!req.tfaVerified) {
      const enabled = await queryOne(
        'SELECT id FROM master_authenticator_secret WHERE is_enabled = TRUE LIMIT 1'
      );
      if (enabled) {
        return res.status(403).json({
          error: 'Authenticator verification required',
          requires2FA: true,
        });
      }
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authorization error' });
  }
}

