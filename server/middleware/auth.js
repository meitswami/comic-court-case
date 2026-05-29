// Authentication Middleware
// Validates JWT tokens for protected routes

import jwt from 'jsonwebtoken';
import { queryOne } from '../lib/mysql.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.userId;

      if (!userId) {
        console.error('[Auth] Token decoded but no userId found:', decoded);
        return res.status(401).json({ error: 'Invalid token: no user ID' });
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
      next();
    } catch (error) {
      console.error('[Auth] Token verification failed:', error.message);
      console.error('[Auth] Token (first 20 chars):', token.substring(0, 20));
      console.error('[Auth] JWT_SECRET configured:', !!JWT_SECRET);
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

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authorization error' });
  }
}

