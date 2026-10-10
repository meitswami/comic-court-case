// Admin Routes - user accounts
//
// Everything else in the admin console goes through the data API with admin
// rights. Accounts are handled here because they involve the `users` table
// (emails, password hashes), which the data API never exposes.

import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { query, queryOne, generateUUID } from '../lib/mysql.js';
import { signUp } from '../lib/auth.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function adminCount() {
  const row = await queryOne("SELECT COUNT(DISTINCT user_id) AS total FROM user_roles WHERE role = 'admin'");
  return Number(row.total) || 0;
}

async function isAdminUser(userId) {
  return !!(await queryOne("SELECT id FROM user_roles WHERE user_id = ? AND role = 'admin'", [userId]));
}

router.get('/users', async (req, res) => {
  try {
    const users = await query(
      `SELECT u.id, u.email, u.email_verified, u.created_at,
              p.display_name,
              COALESCE(w.balance, 0) AS wallet_balance,
              CASE WHEN EXISTS (
                SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin'
              ) THEN 'admin' ELSE 'user' END AS role
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN user_wallets w ON w.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT 5000`
    );
    res.json(
      users.map((user) => ({
        ...user,
        email_verified: Number(user.email_verified) === 1,
        wallet_balance: Number(user.wallet_balance) || 0,
      }))
    );
  } catch (error) {
    console.error('[Admin] list users:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const displayName = String((req.body && req.body.displayName) || '').trim();
    const role = req.body && req.body.role === 'admin' ? 'admin' : 'user';

    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const result = await signUp(email, password, { display_name: displayName || null });
    if (result.error) return res.status(400).json({ error: result.error.message });

    const userId = result.data.user.id;
    if (role === 'admin') {
      await query('INSERT IGNORE INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [
        generateUUID(),
        userId,
        'admin',
      ]);
    }
    res.json({ id: userId, email, role });
  } catch (error) {
    console.error('[Admin] create user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const userId = req.params.id;
    const role = req.body && req.body.role;
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: 'Unknown role' });

    const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (role === 'user' && (await isAdminUser(userId)) && (await adminCount()) <= 1) {
      return res.status(400).json({ error: 'This is the only admin. Make another user an admin first.' });
    }

    await query('INSERT IGNORE INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [generateUUID(), userId, role]);
    await query('DELETE FROM user_roles WHERE user_id = ? AND role <> ?', [userId, role]);
    res.json({ id: userId, role });
  } catch (error) {
    console.error('[Admin] update role:', error);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.userId) return res.status(400).json({ error: 'You cannot delete your own account.' });

    const user = await queryOne('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if ((await isAdminUser(userId)) && (await adminCount()) <= 1) {
      return res.status(400).json({ error: 'This is the only admin and cannot be deleted.' });
    }

    try {
      await query('DELETE FROM users WHERE id = ?', [userId]);
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
        return res.status(409).json({
          error: 'This user has payments or other records linked to them and cannot be deleted.',
        });
      }
      throw error;
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error('[Admin] delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
