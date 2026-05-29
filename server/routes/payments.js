// Payments Routes
// Handles payment-related endpoints (converted from Edge Functions)

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, update, generateUUID } from '../lib/mysql.js';

const router = express.Router();

// Create payment (from create-payment Edge Function)
router.post('/create', authenticate, async (req, res) => {
  try {
    const { amount, gateway, metadata } = req.body;
    const paymentGateway = gateway || 'wallet';
    const metadataObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const paymentType = metadataObj?.type || 'hearing_payment';
    
    const paymentId = generateUUID();
    
    // Create payment record
    await insert('payments', {
      id: paymentId,
      user_id: req.userId,
      amount,
      gateway: paymentGateway,
      status: 'pending',
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    
    // If wallet payment, process immediately
    if (paymentGateway === 'wallet') {
      // Check wallet balance
      const wallet = await queryOne(
        'SELECT id, balance FROM user_wallets WHERE user_id = ?',
        [req.userId]
      );
      
      if (!wallet) {
        // Create wallet if it doesn't exist
        const walletId = generateUUID();
        await insert('user_wallets', {
          id: walletId,
          user_id: req.userId,
          balance: 0.00,
          currency: 'INR',
        });
        
        await update('payments', {
          status: 'failed',
          failure_reason: 'Insufficient wallet balance'
        }, { id: paymentId });
        
        return res.status(400).json({ 
          error: 'Insufficient wallet balance',
          payment_id: paymentId,
          status: 'failed'
        });
      }
      
      const walletBalance = typeof wallet.balance === 'string' 
        ? parseFloat(wallet.balance) 
        : Number(wallet.balance);
      
      if (walletBalance < amount) {
        // Update payment status to failed
        await update('payments', {
          status: 'failed',
          failure_reason: 'Insufficient wallet balance'
        }, { id: paymentId });
        
        return res.status(400).json({ 
          error: 'Insufficient wallet balance',
          payment_id: paymentId,
          status: 'failed'
        });
      }
      
      // Deduct from wallet
      const newBalance = walletBalance - amount;
      await update('user_wallets', {
        balance: newBalance
      }, { id: wallet.id });
      
      // Create transaction record
      const transactionId = generateUUID();
      await insert('transactions', {
        id: transactionId,
        user_id: req.userId,
        transaction_type: paymentType === 'wallet_topup' ? 'wallet_topup' : paymentType,
        amount: -amount, // Negative for deduction
        balance_before: walletBalance,
        balance_after: newBalance,
        description: `Payment for ${paymentType}`,
        reference_id: paymentId,
        reference_type: 'payment',
      });
      
      // Update payment status to completed
      await update('payments', {
        status: 'completed',
        completed_at: new Date()
      }, { id: paymentId });
      
      const payment = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
      return res.json({
        ...payment,
        status: 'completed',
        id: paymentId,
        payment_id: paymentId
      });
    }
    
    // For payment gateway, return pending payment
    const payment = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
    res.json(payment);
  } catch (error) {
    console.error('[Payment Create] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Payment webhook (from payment-webhook Edge Function)
router.post('/webhook', async (req, res) => {
  try {
    // Handle payment gateway webhook
    // Verify signature, update payment status, etc.
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user payments
router.get('/', authenticate, async (req, res) => {
  try {
    const payments = await query(
      'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user transactions (wallet transactions)
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const transactions = await query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.userId]
    );
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get wallet balance
router.get('/wallet/balance', authenticate, async (req, res) => {
  try {
    console.log('[Wallet Balance] Fetching balance for userId:', req.userId, 'Type:', typeof req.userId);
    
    // Try to find wallet - ensure exact match
    const wallet = await queryOne(
      'SELECT id, user_id, balance, currency FROM user_wallets WHERE user_id = ?',
      [req.userId]
    );
    
    console.log('[Wallet Balance] Query result:', wallet);
    console.log('[Wallet Balance] Query result type:', wallet ? typeof wallet.balance : 'null');
    
    if (!wallet) {
      console.log('[Wallet Balance] Wallet not found, checking all wallets for debugging...');
      // Debug: Check if any wallets exist
      const allWallets = await query('SELECT user_id, balance FROM user_wallets LIMIT 5');
      console.log('[Wallet Balance] Sample wallets in DB:', allWallets);
      
      console.log('[Wallet Balance] Creating new wallet for userId:', req.userId);
      // Create wallet if it doesn't exist
      const walletId = generateUUID();
      await insert('user_wallets', {
        id: walletId,
        user_id: req.userId,
        balance: 0.00,
        currency: 'INR',
      });
      return res.json({ balance: 0.00 });
    }
    
    // Parse balance - handle decimal/string conversion
    // MySQL DECIMAL types are returned as strings, so parse it
    let balanceValue = 0.00;
    if (wallet.balance !== null && wallet.balance !== undefined) {
      balanceValue = typeof wallet.balance === 'string' 
        ? parseFloat(wallet.balance) 
        : Number(wallet.balance);
    }
    
    // Ensure it's a valid number
    if (isNaN(balanceValue)) {
      balanceValue = 0.00;
    }
    
    console.log('[Wallet Balance] Returning balance:', balanceValue);
    
    res.json({ balance: balanceValue });
  } catch (error) {
    console.error('[Wallet Balance] Error:', error);
    console.error('[Wallet Balance] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

export default router;

