// Payment service
//
// One place decides what a payment costs, takes the money (wallet or Cashfree)
// and delivers what was bought. The browser never sets a price for a hearing
// and never marks anything as paid.
//
//   startPayment      create a payment; wallet payments finish immediately,
//                     Cashfree payments return a session for the checkout popup
//   verifyCashfree    ask Cashfree whether an order was paid, then finish it
//   completePayment   idempotent: credits wallet / creates the court session /
//                     records promo usage and an invoice, exactly once

import crypto from 'crypto';
import { pool, query, queryOne, generateUUID } from './mysql.js';
import { adjustWallet } from './wallet.js';
import {
  getCashfreeConfig,
  createOrder,
  fetchOrder,
  fetchOrderPayments,
} from './cashfree.js';

export const COURT_HEARING_FEE = 1200;
export const AI_LAWYER_FEE = 500;
const MIN_TOPUP = 100;
const MAX_TOPUP = 500000;

const PAYMENT_TYPES = ['hearing_payment', 'wallet_topup', 'addon_payment'];
// Add-ons bought on their own to unlock a feature; not part of a hearing.
export const FEATURE_ADDON_CODES = ['case-strength-suggestions', 'rti-tutorial'];
const ONLINE_GATEWAYS = ['cashfree', 'razorpay', 'phonepe'];

// "Valid until" is entered as a date, so the code works through that whole day.
export const PROMO_NOT_EXPIRED = `(valid_until IS NULL
  OR IF(TIME(valid_until) = '00:00:00', valid_until + INTERVAL 1 DAY, valid_until) > NOW())`;

export class PaymentError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function parseMeta(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

// The gateway customers can pay with right now: active AND configured.
export async function getActiveGateway() {
  const row = await queryOne(
    'SELECT gateway, test_mode FROM payment_gateway_settings WHERE is_active = 1 LIMIT 1'
  );
  if (!row) return null;
  if (row.gateway === 'cashfree') {
    const config = await getCashfreeConfig();
    if (!config) return null;
    return { gateway: 'cashfree', mode: config.mode };
  }
  // Razorpay / PhonePe keys can be stored, but their checkout is not built.
  return { gateway: row.gateway, mode: Number(row.test_mode) === 1 ? 'sandbox' : 'production', unsupported: true };
}

async function applyPromo(code, amount) {
  if (!code || typeof code !== 'string' || !code.trim()) return { discount: 0, promoId: null };
  const promo = await queryOne(
    `SELECT * FROM promo_codes
     WHERE code = ? AND is_active = 1
       AND valid_from <= NOW()
       AND ${PROMO_NOT_EXPIRED}`,
    [code.trim().toUpperCase()]
  );
  if (!promo) throw new PaymentError('This promo code is not valid.');
  if (promo.max_uses !== null && Number(promo.used_count) >= Number(promo.max_uses)) {
    throw new PaymentError('This promo code has been fully used.');
  }
  const minimum = Number(promo.min_purchase_amount) || 0;
  if (amount < minimum) {
    throw new PaymentError(`This promo code needs a minimum purchase of ₹${minimum}.`);
  }
  let discount = 0;
  if (promo.discount_type === 'percentage') {
    discount = (amount * Number(promo.discount_value)) / 100;
    if (promo.max_discount_amount !== null) {
      discount = Math.min(discount, Number(promo.max_discount_amount));
    }
  } else {
    discount = Number(promo.discount_value);
  }
  discount = money(Math.min(Math.max(discount, 0), amount));
  return { discount, promoId: promo.id, code: promo.code };
}

// Works out what a promo code would take off, without creating a payment.
export async function previewPromo(code, amount) {
  return applyPromo(code, money(amount));
}

async function priceHearing(userId, input) {
  const caseId = input.case_id;
  const owned = caseId
    ? await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [caseId, userId])
    : null;
  if (!owned) throw new PaymentError('You can only book a hearing for your own case.', 403);

  const lawyerType = input.lawyer_type;
  if (lawyerType !== 'ai_lawyer' && lawyerType !== 'actual_lawyer') {
    throw new PaymentError('Please choose a lawyer option.');
  }
  if (lawyerType === 'actual_lawyer' && !String(input.callback_number || '').trim()) {
    throw new PaymentError('A mobile number is required for an Actual Lawyer consultation.');
  }

  const requested = Array.isArray(input.addon_ids) ? [...new Set(input.addon_ids.map(String))].slice(0, 20) : [];
  let addons = [];
  if (requested.length > 0) {
    addons = await query(
      `SELECT id, code, name, price FROM addons
       WHERE status = 'active' AND id IN (${requested.map(() => '?').join(', ')})
         AND code NOT IN (${FEATURE_ADDON_CODES.map(() => '?').join(', ')})`,
      [...requested, ...FEATURE_ADDON_CODES]
    );
  }

  const addonTotal = addons.reduce((sum, addon) => sum + Number(addon.price), 0);
  const total = COURT_HEARING_FEE + (lawyerType === 'ai_lawyer' ? AI_LAWYER_FEE : 0) + addonTotal;
  // With an actual lawyer only the hearing fee is taken now; the lawyer's fee
  // is quoted after the consultation.
  const dueNow = lawyerType === 'ai_lawyer' ? total : COURT_HEARING_FEE;

  return {
    amount: money(dueNow),
    meta: {
      case_id: caseId,
      lawyer_type: lawyerType,
      callback_number: lawyerType === 'actual_lawyer' ? String(input.callback_number).trim().slice(0, 50) : null,
      addons: addons.map((a) => ({ id: a.id, code: a.code, name: a.name, price: Number(a.price) })),
      total_fee: money(total),
    },
  };
}

async function priceAddon(input, meta) {
  const addonId = input.addon_id || meta.addon_id || null;
  const addonCode = input.addon_code || meta.addon_code || null;
  let addon = null;
  if (addonId) {
    addon = await queryOne("SELECT id, code, name, price FROM addons WHERE id = ? AND status = 'active'", [addonId]);
  }
  if (!addon && addonCode) {
    addon = await queryOne("SELECT id, code, name, price FROM addons WHERE code = ? AND status = 'active'", [addonCode]);
  }
  if (addon) {
    return {
      amount: money(addon.price),
      meta: { addon_id: addon.id, addon_code: addon.code, addon_name: addon.name },
    };
  }
  // Add-on that is not in the catalogue (legacy fixed-price feature).
  const amount = money(input.amount);
  if (!Number.isFinite(amount) || amount < 1) throw new PaymentError('Invalid amount.');
  return { amount, meta: { addon_id: null, addon_code: addonCode } };
}

function cleanPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// input: { gateway, type, amount, metadata, case_id, lawyer_type, addon_ids,
//          addon_id, addon_code, promo_code, callback_number, customer_phone }
export async function startPayment(user, input, baseUrl) {
  const userId = user.id;
  const incomingMeta = parseMeta(input.metadata);
  const type = input.type || incomingMeta.type || 'hearing_payment';
  if (!PAYMENT_TYPES.includes(type)) throw new PaymentError('Unknown payment type.');

  const gateway = input.gateway || 'wallet';
  if (gateway !== 'wallet' && !ONLINE_GATEWAYS.includes(gateway)) {
    throw new PaymentError('Unknown payment method.');
  }

  let amount;
  let meta = { type };

  if (type === 'hearing_payment') {
    const priced = await priceHearing(userId, input);
    amount = priced.amount;
    meta = { ...meta, ...priced.meta };
  } else if (type === 'wallet_topup') {
    if (gateway === 'wallet') throw new PaymentError('A wallet cannot be topped up from itself.');
    amount = money(input.amount);
    if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
      throw new PaymentError(`Minimum top-up amount is ₹${MIN_TOPUP}.`);
    }
    if (amount > MAX_TOPUP) throw new PaymentError(`Maximum top-up amount is ₹${MAX_TOPUP}.`);
  } else {
    const priced = await priceAddon(input, incomingMeta);
    amount = priced.amount;
    meta = { ...meta, ...priced.meta };
  }

  const subtotal = amount;
  let discount = 0;
  if (type !== 'wallet_topup' && input.promo_code) {
    const promo = await applyPromo(input.promo_code, amount);
    discount = promo.discount;
    amount = money(amount - discount);
    meta.promo_code_id = promo.promoId;
    meta.promo_code = promo.code;
  }
  meta.subtotal = subtotal;
  meta.discount = discount;

  // Validate the online gateway before anything is written.
  let cashfree = null;
  let phone = null;
  if (gateway !== 'wallet' && amount > 0) {
    if (gateway !== 'cashfree') {
      throw new PaymentError(
        `${gateway === 'razorpay' ? 'Razorpay' : 'PhonePe'} checkout is not available. Please pay with your wallet, or ask the admin to activate Cashfree.`
      );
    }
    cashfree = await getCashfreeConfig();
    if (!cashfree || !cashfree.isActive) {
      throw new PaymentError('Online payment is not available right now. Please use your wallet.', 503);
    }
    phone = cleanPhone(input.customer_phone || input.callback_number);
    if (!/^[6-9]\d{9}$/.test(phone)) {
      throw new PaymentError('Please enter a valid 10-digit mobile number for the payment.');
    }
  }

  const paymentId = generateUUID();
  await query(
    `INSERT INTO payments (id, user_id, amount, currency, gateway, status, metadata)
     VALUES (?, ?, ?, 'INR', ?, 'pending', ?)`,
    [paymentId, userId, amount, gateway, JSON.stringify(meta)]
  );

  // Wallet (or nothing left to pay after a promo): finish right away.
  if (gateway === 'wallet' || amount === 0) {
    try {
      const done = await completePayment(paymentId, {});
      return { ...done, discount_amount: discount };
    } catch (error) {
      const insufficient = error && error.code === 'INSUFFICIENT_BALANCE';
      await query(
        "UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'pending'",
        [insufficient ? 'Insufficient wallet balance' : String(error.message).slice(0, 500), paymentId]
      );
      if (insufficient) {
        throw new PaymentError('Insufficient wallet balance', 400, { payment_id: paymentId, status: 'failed' });
      }
      throw error;
    }
  }

  // Cashfree: create the order and hand the session to the browser.
  const orderId = `ENY_${paymentId.replace(/-/g, '')}`;
  let order;
  try {
    order = await createOrder(cashfree, {
      orderId,
      amount,
      customerId: userId.replace(/[^A-Za-z0-9]/g, ''),
      customerPhone: phone,
      customerEmail: user.email,
      returnUrl: baseUrl ? `${baseUrl}/payment/return?order_id=${orderId}` : undefined,
      notifyUrl: baseUrl ? `${baseUrl}/api/payments/cashfree/webhook` : undefined,
      note: `eNyayaSetu ${type.replace('_', ' ')}`,
    });
  } catch (error) {
    await query(
      "UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?",
      [String(error.message).slice(0, 500), paymentId]
    );
    throw error;
  }

  await query(
    "UPDATE payments SET status = 'processing', gateway_order_id = ?, gateway_transaction_id = ? WHERE id = ?",
    [orderId, order.cf_order_id ? String(order.cf_order_id) : null, paymentId]
  );

  return {
    id: paymentId,
    payment_id: paymentId,
    status: 'pending',
    gateway: 'cashfree',
    amount,
    discount_amount: discount,
    gateway_order_id: orderId,
    payment_session_id: order.payment_session_id,
    cashfree_mode: cashfree.mode,
  };
}

async function uniqueCourtCode(conn) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) code += chars.charAt(crypto.randomInt(chars.length));
    const [rows] = await conn.execute('SELECT id FROM court_sessions WHERE court_code = ?', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not generate a court code');
}

async function nextInvoiceNumber(conn, skip = 0) {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const [rows] = await conn.execute(
    'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1',
    [`${prefix}%`]
  );
  const last = rows.length ? Number.parseInt(String(rows[0].invoice_number).split('-')[2], 10) || 0 : 0;
  return `${prefix}${String(last + 1 + skip).padStart(6, '0')}`;
}

function describe(type, meta) {
  if (type === 'wallet_topup') return 'Wallet top-up';
  if (type === 'addon_payment') return `Add-on: ${meta.addon_name || meta.addon_code || 'feature'}`;
  return 'Court hearing';
}

// Finishes a payment exactly once. Safe to call from the verify endpoint and
// the webhook at the same time: the payment row is locked, and a payment that
// is already completed just returns its result.
export async function completePayment(paymentId, { gatewayPaymentId = null } = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT * FROM payments WHERE id = ? FOR UPDATE', [paymentId]);
    if (rows.length === 0) throw new PaymentError('Payment not found.', 404);
    const payment = rows[0];
    const meta = parseMeta(payment.metadata);
    const type = meta.type || 'hearing_payment';
    const amount = money(payment.amount);

    if (payment.status === 'completed') {
      await conn.commit();
      return resultFor(payment, meta);
    }
    if (payment.status !== 'pending' && payment.status !== 'processing') {
      throw new PaymentError(`This payment is ${payment.status} and cannot be completed.`, 409);
    }

    if (payment.gateway === 'wallet' && amount > 0) {
      await adjustWallet({
        userId: payment.user_id,
        amount: -amount,
        type: type === 'addon_payment' ? 'addon_payment' : 'hearing_payment',
        description: describe(type, meta),
        referenceId: payment.id,
        referenceType: 'payment',
        connection: conn,
      });
    }

    if (type === 'wallet_topup') {
      await adjustWallet({
        userId: payment.user_id,
        amount,
        type: 'wallet_topup',
        description: `Wallet top-up via ${payment.gateway}`,
        referenceId: payment.id,
        referenceType: 'payment',
        connection: conn,
      });
    }

    if (type === 'hearing_payment' && meta.case_id) {
      const sessionId = generateUUID();
      const courtCode = await uniqueCourtCode(conn);
      const isAi = meta.lawyer_type === 'ai_lawyer';
      await conn.execute(
        `INSERT INTO court_sessions
           (id, case_id, court_code, status, created_by, payment_status, payment_id,
            court_hearing_fee, lawyer_type, ai_lawyer_fee, total_fee, payment_method,
            actual_lawyer_consultation_requested, actual_lawyer_callback_number)
         VALUES (?, ?, ?, 'scheduled', ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          meta.case_id,
          courtCode,
          payment.user_id,
          payment.id,
          COURT_HEARING_FEE,
          meta.lawyer_type || null,
          isAi ? AI_LAWYER_FEE : 0,
          meta.total_fee || amount,
          payment.gateway,
          isAi ? 0 : 1,
          isAi ? null : meta.callback_number || null,
        ]
      );
      for (const addon of Array.isArray(meta.addons) ? meta.addons : []) {
        await conn.execute(
          `INSERT INTO case_addons
             (id, case_id, hearing_session_id, addon_id, user_id, price, payment_id, is_active, activated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
          [generateUUID(), meta.case_id, sessionId, addon.id, payment.user_id, addon.price, payment.id]
        );
      }
      meta.session_id = sessionId;
      meta.court_code = courtCode;
    }

    if (meta.promo_code_id && Number(meta.discount) > 0) {
      // Count the use only while uses remain, so a code cannot be over-used
      // by payments racing each other.
      const [counted] = await conn.execute(
        `UPDATE promo_codes SET used_count = used_count + 1
         WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)`,
        [meta.promo_code_id]
      );
      if (counted.affectedRows === 0 && payment.gateway === 'wallet') {
        // Nothing has been charged yet (same transaction): refuse.
        throw new PaymentError('This promo code has been fully used.');
      }
      await conn.execute(
        `INSERT IGNORE INTO promo_code_usage (id, promo_code_id, user_id, payment_id, discount_amount)
         VALUES (?, ?, ?, ?, ?)`,
        [generateUUID(), meta.promo_code_id, payment.user_id, payment.id, meta.discount]
      );
    }

    const invoiceId = generateUUID();
    const subtotal = Number.isFinite(Number(meta.subtotal)) ? money(meta.subtotal) : amount;
    const invoiceData = JSON.stringify({
      type,
      description: describe(type, meta),
      gateway: payment.gateway,
      case_id: meta.case_id || null,
      court_code: meta.court_code || null,
      addons: meta.addons || [],
      promo_code: meta.promo_code || null,
    });
    // Two payments finishing at once can pick the same next number; the unique
    // key rejects the second, which then simply takes the following number.
    let invoiceNumber = null;
    for (let attempt = 0; attempt < 8 && !invoiceNumber; attempt += 1) {
      const candidate = await nextInvoiceNumber(conn, attempt);
      try {
        await conn.execute(
          `INSERT INTO invoices
             (id, invoice_number, user_id, payment_id, amount, tax_amount, discount_amount,
              total_amount, currency, status, invoice_data, paid_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'INR', 'paid', ?, NOW())`,
          [invoiceId, candidate, payment.user_id, payment.id, subtotal, money(meta.discount || 0), amount, invoiceData]
        );
        invoiceNumber = candidate;
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    if (!invoiceNumber) throw new Error('Could not allocate an invoice number');
    meta.invoice_id = invoiceId;
    meta.invoice_number = invoiceNumber;
    if (meta.session_id) {
      await conn.execute('UPDATE court_sessions SET invoice_id = ? WHERE id = ?', [invoiceId, meta.session_id]);
    }

    await conn.execute(
      `UPDATE payments
       SET status = 'completed', completed_at = NOW(), metadata = ?,
           gateway_payment_id = COALESCE(?, gateway_payment_id)
       WHERE id = ?`,
      [JSON.stringify(meta), gatewayPaymentId, payment.id]
    );

    await conn.commit();
    return resultFor({ ...payment, status: 'completed' }, meta);
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      // ignore
    }
    throw error;
  } finally {
    conn.release();
  }
}

function resultFor(payment, meta) {
  return {
    id: payment.id,
    payment_id: payment.id,
    status: payment.status,
    gateway: payment.gateway,
    amount: money(payment.amount),
    type: meta.type || 'hearing_payment',
    session: meta.session_id ? { id: meta.session_id, court_code: meta.court_code } : null,
    invoice_number: meta.invoice_number || null,
  };
}

export async function getPaymentResult(paymentId, userId) {
  const payment = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment || (userId && payment.user_id !== userId)) throw new PaymentError('Payment not found.', 404);
  return resultFor(payment, parseMeta(payment.metadata));
}

// Finds a Cashfree payment by our payment id or by the Cashfree order id.
async function findCashfreePayment({ paymentId, orderId }) {
  if (paymentId) return queryOne("SELECT * FROM payments WHERE id = ? AND gateway = 'cashfree'", [paymentId]);
  if (orderId) {
    return queryOne("SELECT * FROM payments WHERE gateway_order_id = ? AND gateway = 'cashfree'", [orderId]);
  }
  return null;
}

// Asks Cashfree for the real state of the order. `userId` limits the lookup to
// the payment's owner; the webhook passes null.
export async function verifyCashfree({ paymentId, orderId }, userId) {
  const payment = await findCashfreePayment({ paymentId, orderId });
  if (!payment || (userId && payment.user_id !== userId)) throw new PaymentError('Payment not found.', 404);

  const meta = parseMeta(payment.metadata);
  if (payment.status === 'completed' || payment.status === 'failed' || payment.status === 'cancelled') {
    return resultFor(payment, meta);
  }

  const config = await getCashfreeConfig();
  if (!config) throw new PaymentError('Cashfree is not configured.', 503);

  const order = await fetchOrder(config, payment.gateway_order_id);

  if (order.order_status === 'PAID') {
    if (Math.abs(Number(order.order_amount) - Number(payment.amount)) > 0.01) {
      console.error('[Cashfree] Amount mismatch for', payment.id, order.order_amount, payment.amount);
      throw new PaymentError('The paid amount does not match this order. Please contact support.', 409);
    }
    let gatewayPaymentId = null;
    try {
      const attempts = await fetchOrderPayments(config, payment.gateway_order_id);
      const success = attempts.find((a) => a.payment_status === 'SUCCESS');
      if (success && success.cf_payment_id) gatewayPaymentId = String(success.cf_payment_id);
    } catch (error) {
      // The order itself is confirmed as PAID; the payment id is informational.
    }
    return completePayment(payment.id, { gatewayPaymentId });
  }

  if (order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED') {
    await query(
      "UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ? AND status IN ('pending', 'processing')",
      [`Cashfree order ${String(order.order_status).toLowerCase()}`, payment.id]
    );
    return resultFor({ ...payment, status: 'failed' }, meta);
  }

  // ACTIVE: not paid yet.
  return resultFor({ ...payment, status: 'pending' }, meta);
}
