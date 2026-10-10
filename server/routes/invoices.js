// Invoice Routes
// Handles invoice-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, generateUUID } from '../lib/mysql.js';

const router = express.Router();

// Get (or create) the invoice for one of the caller's completed payments.
// Amounts always come from the payment record, never from the request.
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { payment_id } = req.body;

    const payment = await queryOne(
      "SELECT id, amount FROM payments WHERE id = ? AND user_id = ? AND status = 'completed'",
      [payment_id, req.userId]
    );
    if (!payment) {
      return res.status(404).json({ error: 'Completed payment not found' });
    }

    const existing = await queryOne('SELECT * FROM invoices WHERE payment_id = ? AND user_id = ?', [
      payment_id,
      req.userId,
    ]);
    if (existing) {
      return res.json(existing);
    }
    
    const invoiceNumber = await generateInvoiceNumber();
    const amount = Number(payment.amount);
    
    const invoiceId = generateUUID();
    await insert('invoices', {
      id: invoiceId,
      invoice_number: invoiceNumber,
      user_id: req.userId,
      payment_id,
      amount,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: amount,
      status: 'paid',
      paid_at: new Date(),
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

