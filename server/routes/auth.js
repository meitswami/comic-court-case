// Auth Routes
// Handles authentication endpoints

import express from 'express';
import { signUp, signIn, isAdmin, hasAdminAccess } from '../lib/auth.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { email, password, metadata } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const result = await signUp(email, password, metadata);
    
    if (result.error) {
      console.error('Signup error:', result.error.message);
      return res.status(400).json({ error: result.error.message });
    }
    
    res.json(result.data);
  } catch (error) {
    console.error('Signup exception:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Sign in
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    console.log('Signin attempt for:', email);
    const result = await signIn(email, password);
    
    if (result.error) {
      console.error('Signin error:', result.error.message);
      return res.status(401).json({ error: result.error.message });
    }
    
    if (result.data.requires2FA) {
      // Admin account: password accepted, authenticator code still required.
      console.log('Signin password accepted, authenticator code required for:', email);
    } else {
      console.log('Signin successful for:', email);
    }
    res.json(result.data);
  } catch (error) {
    console.error('Signin exception:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Check if user is admin
router.get('/is-admin', authenticate, async (req, res) => {
  try {
    const hasRole = await isAdmin(req.userId);
    const access = hasRole && (await hasAdminAccess(req.userId, req.tfaVerified));
    // requires2FA: the account is an admin but this session never passed the
    // authenticator check, so the client should send the user back to sign in.
    res.json({ isAdmin: access, requires2FA: hasRole && !access });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;

