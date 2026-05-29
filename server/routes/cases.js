// Cases Routes
// Handles case-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, update, remove } from '../lib/mysql.js';
import { isAdmin } from '../lib/auth.js';

const router = express.Router();

// Get all cases for user (or all cases if admin)
router.get('/', authenticate, async (req, res) => {
  try {
    const userIsAdmin = await isAdmin(req.userId);
    
    let cases;
    if (userIsAdmin) {
      // Admins can see all cases
      cases = await query(
        'SELECT * FROM cases ORDER BY created_at DESC'
      );
    } else {
      // Regular users see only their cases
      cases = await query(
        'SELECT * FROM cases WHERE user_id = ? ORDER BY created_at DESC',
        [req.userId]
      );
    }
    res.json(cases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single case
router.get('/:id', authenticate, async (req, res) => {
  try {
    const caseData = await queryOne(
      'SELECT * FROM cases WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found' });
    }
    
    res.json(caseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create case
router.post('/', authenticate, async (req, res) => {
  try {
    const { case_number, title, description, plaintiff, defendant, category, user_role } = req.body;
    
    const caseId = require('crypto').randomUUID();
    await insert('cases', {
      id: caseId,
      user_id: req.userId,
      case_number,
      title,
      description,
      plaintiff,
      defendant,
      category: category || 'Custom Case',
      user_role,
      status: 'pending',
    });
    
    const newCase = await queryOne('SELECT * FROM cases WHERE id = ?', [caseId]);
    res.status(201).json(newCase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update case
router.put('/:id', authenticate, async (req, res) => {
  try {
    await update('cases', req.body, { id: req.params.id, user_id: req.userId });
    const updatedCase = await queryOne('SELECT * FROM cases WHERE id = ?', [req.params.id]);
    res.json(updatedCase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete case
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await remove('cases', { id: req.params.id, user_id: req.userId });
    res.json({ message: 'Case deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

