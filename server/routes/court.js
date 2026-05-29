// Court Routes
// Handles court session-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, generateUUID } from '../lib/mysql.js';

const router = express.Router();

// Get court sessions (with optional filters)
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { case_id, payment_status } = req.query;
    let sql = 'SELECT * FROM court_sessions WHERE 1=1';
    const params = [];

    if (case_id) {
      sql += ' AND case_id = ?';
      params.push(case_id);
    }

    if (payment_status) {
      sql += ' AND payment_status = ?';
      params.push(payment_status);
    }

    sql += ' ORDER BY created_at DESC';

    const sessions = await query(sql, params);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get court session by code
router.get('/session/:code', async (req, res) => {
  try {
    const session = await queryOne(
      'SELECT * FROM court_sessions WHERE court_code = ?',
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

// Create court session
router.post('/session', authenticate, async (req, res) => {
  try {
    const { case_id } = req.body;
    
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
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate court code helper
function generateCourtCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default router;

