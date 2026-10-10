// Payments Routes
//
//   POST /api/payments/create             start a payment (wallet or Cashfree)
//   GET  /api/payments/gateway            which online gateway is live (public)
//   POST /api/payments/promo/preview      discount a promo code would give
//   POST /api/payments/cashfree/verify    confirm a Cashfree payment
//   POST /api/payments/cashfree/webhook   Cashfree server-to-server notification
//   GET  /api/payments/:id/status         status of one of your payments
//   GET  /api/payments                    your payments
//   GET  /api/payments/transactions       your wallet ledger
//   GET  /api/payments/wallet/balance     your wallet balance
//
// Pricing, wallet debits and delivery all happen in server/lib/payments.js.

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, generateUUID } from '../lib/mysql.js';
import {
  startPayment,
  verifyCashfree,
  getPaymentResult,
  getActiveGateway,
  previewPromo,
  PaymentError,
} from '../lib/payments.js';
import { getCashfreeConfig, verifyWebhookSignature, GatewayError } from '../lib/cashfree.js';

const router = express.Router();

// Public address of the site, used for Cashfree's return and webhook URLs.
export function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

export function sendPaymentError(res, error, label) {
  if (error instanceof PaymentError) {
    return res.status(error.status).json({ error: error.message, ...error.extra });
  }
  if (error instanceof GatewayError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`[Payments] ${label}:`, error);
  return res.status(500).json({ error: 'The payment could not be processed. Please try again.' });
}

// Shared by POST /api/payments/create and the create-payment function.
export async function handleCreatePayment(req, res) {
  try {
    const result = await startPayment(req.user, req.body || {}, publicBaseUrl(req));
    res.json(result);
  } catch (error) {
    sendPaymentError(res, error, 'create');
  }
}

router.post('/create', authenticate, handleCreatePayment);

// Which gateway the checkout should offer. No secrets.
router.get('/gateway', async (req, res) => {
  try {
    const active = await getActiveGateway();
    if (!active || active.unsupported) return res.json({ gateway: null });
    res.json({ gateway: active.gateway, mode: active.mode });
  } catch (error) {
    console.error('[Payments] gateway:', error);
    res.json({ gateway: null });
  }
});

router.post('/promo/preview', authenticate, async (req, res) => {
  try {
    const { code, amount } = req.body || {};
    const promo = await previewPromo(code, amount);
    res.json({ discount: promo.discount, code: promo.code || null });
  } catch (error) {
    sendPaymentError(res, error, 'promo preview');
  }
});

router.post('/cashfree/verify', authenticate, async (req, res) => {
  try {
    const { payment_id: paymentId, order_id: orderId } = req.body || {};
    if (!paymentId && !orderId) return res.status(400).json({ error: 'payment_id or order_id is required' });
    res.json(await verifyCashfree({ paymentId, orderId }, req.userId));
  } catch (error) {
    sendPaymentError(res, error, 'cashfree verify');
  }
});

// Cashfree calls this from its servers. The signature proves it is Cashfree;
// the order is then re-checked with Cashfree before anything is delivered.
router.post('/cashfree/webhook', async (req, res) => {
  try {
    const config = await getCashfreeConfig();
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!config || !verifyWebhookSignature(config, req.rawBody, timestamp, signature)) {
      // Cashfree's dashboard "test webhook" sends an unsigned ping; answer 200
      // to an empty body so the URL can be saved, reject everything else.
      if (!req.rawBody || req.rawBody.length === 0) return res.json({ received: true });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const orderId = req.body && req.body.data && req.body.data.order && req.body.data.order.order_id;
    if (orderId) {
      try {
        await verifyCashfree({ orderId }, null);
      } catch (error) {
        if (!(error instanceof PaymentError && error.status === 404)) {
          console.error('[Cashfree webhook] could not settle', orderId, error.message);
          return res.status(500).json({ error: 'Temporary failure' });
        }
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('[Cashfree webhook]', error);
    res.status(500).json({ error: 'Temporary failure' });
  }
});

// Kept so an older webhook URL does not 404.
router.post('/webhook', (req, res) => res.json({ received: true }));

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
    const wallet = await queryOne(
      'SELECT id, balance FROM user_wallets WHERE user_id = ?',
      [req.userId]
    );

    if (!wallet) {
      await insert('user_wallets', {
        id: generateUUID(),
        user_id: req.userId,
        balance: 0.0,
        currency: 'INR',
      });
      return res.json({ balance: 0.0 });
    }

    const balance = Number(wallet.balance);
    res.json({ balance: Number.isNaN(balance) ? 0.0 : balance });
  } catch (error) {
    console.error('[Wallet Balance] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/status', authenticate, async (req, res) => {
  try {
    res.json(await getPaymentResult(req.params.id, req.userId));
  } catch (error) {
    sendPaymentError(res, error, 'status');
  }
});

export default router;
