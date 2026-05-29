// Invoice Routes
// Handles invoice-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert } from '../lib/mysql.js';

const router = express.Router();

// Generate invoice (from generate-invoice Edge Function)
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { payment_id, amount, tax_amount, discount_amount } = req.body;
    
    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();
    
    const invoiceId = require('crypto').randomUUID();
    await insert('invoices', {
      id: invoiceId,
      invoice_number: invoiceNumber,
      user_id: req.userId,
      payment_id,
      amount,
      tax_amount: tax_amount || 0,
      discount_amount: discount_amount || 0,
      total_amount: amount + (tax_amount || 0) - (discount_amount || 0),
      status: 'generated',
    });
    
    const invoice = await queryOne('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user invoices
router.get('/', authenticate, async (req, res) => {
  try {
    const invoices = await query(
      'SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate invoice number helper
async function generateInvoiceNumber() {
  const prefix = 'INV';
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  
  // Get last invoice number for this month
  const lastInvoice = await queryOne(
    `SELECT invoice_number FROM invoices 
     WHERE invoice_number LIKE ? 
     ORDER BY invoice_number DESC LIMIT 1`,
    [`${prefix}-${year}${month}-%`]
  );
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSeq = parseInt(lastInvoice.invoice_number.split('-')[2]);
    sequence = lastSeq + 1;
  }
  
  return `${prefix}-${year}${month}-${String(sequence).padStart(6, '0')}`;
}

export default router;

