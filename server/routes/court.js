// Court Routes
// Handles court session-related endpoints

import express from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, generateUUID } from '../lib/mysql.js';
import { hasAdminAccess } from '../lib/auth.js';

const router = express.Router();

// Lawyer OTP fields never leave the server.
function publicSession(session) {
  if (!session) return session;
  const { actual_lawyer_otp, ...rest } = session;
  return rest;
}

// Get court sessions for the caller's own cases (admins: all), with optional filters
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { case_id, payment_status } = req.query;
    const isAdmin = await hasAdminAccess(req.userId, req.tfaVerified === true);

    let sql = 'SELECT cs.* FROM court_sessions cs JOIN cases c ON c.id = cs.case_id WHERE 1=1';
    const params = [];

    if (!isAdmin) {
      sql += ' AND c.user_id = ?';
      params.push(req.userId);
    }

    if (case_id) {
      sql += ' AND cs.case_id = ?';
      params.push(String(case_id));
    }

    if (payment_status) {
      sql += ' AND cs.payment_status = ?';
      params.push(String(payment_status));
    }

    sql += ' ORDER BY cs.created_at DESC';

    const sessions = await query(sql, params);
    res.json(sessions.map(publicSession));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Look a court session up by its code (used to join a hearing)
router.get('/session/:code', async (req, res) => {
  try {
    const session = await queryOne(
      'SELECT id, case_id, court_code, status, started_at, ended_at FROM court_sessions WHERE court_code = ?',
      [req.params.code]
    );
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create court session for one of the caller's own cases
router.post('/session', authenticate, async (req, res) => {
  try {
    const { case_id } = req.body;

    const ownCase = await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [case_id, req.userId]);
    if (!ownCase) {
      return res.status(403).json({ error: 'You can only start a hearing for your own case.' });
    }
    
    // Generate court code
    const courtCode = generateCourtCode();
    
    const sessionId = generateUUID();
    await insert('court_sessions', {
      id: sessionId,
      case_id,
      court_code: courtCode,
      status: 'scheduled',
      created_by: req.userId,
    });
    
    const session = await queryOne('SELECT * FROM court_sessions WHERE id = ?', [sessionId]);
    res.json(publicSession(session));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate court code helper
function generateCourtCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(crypto.randomInt(chars.length));
  }
  return result;
}

export default router;

