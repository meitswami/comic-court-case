// Cashfree Payment Gateway client.
//
// Credentials are entered by a Super Admin in Admin > Payment Gateways and
// stored in `payment_gateway_settings` (gateway = 'cashfree'):
//   api_key    -> App ID      (x-client-id)
//   api_secret -> Secret Key  (x-client-secret)
//   test_mode  -> true = sandbox, false = production
//
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order

import crypto from 'crypto';
import { queryOne } from './mysql.js';

export class GatewayError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const API_VERSION = process.env.CASHFREE_API_VERSION || '2023-08-01';
const BASE_URLS = {
  sandbox: 'https://sandbox.cashfree.com/pg',
  production: 'https://api.cashfree.com/pg',
};

export async function getCashfreeConfig() {
  const row = await queryOne(
    "SELECT api_key, api_secret, test_mode, is_active FROM payment_gateway_settings WHERE gateway = 'cashfree'"
  );
  if (!row || !row.api_key || !row.api_secret) return null;
  const sandbox = Number(row.test_mode) === 1;
  return {
    appId: String(row.api_key).trim(),
    secret: String(row.api_secret).trim(),
    mode: sandbox ? 'sandbox' : 'production',
    baseUrl: process.env.CASHFREE_BASE_URL || (sandbox ? BASE_URLS.sandbox : BASE_URLS.production),
    isActive: Number(row.is_active) === 1,
  };
}

async function request(config, method, path, body) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        'x-client-id': config.appId,
        'x-client-secret': config.secret,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new GatewayError('Cashfree could not be reached. Please try again.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[Cashfree]', method, path, response.status, JSON.stringify(data).slice(0, 500));
    if (response.status === 401 || response.status === 403) {
      throw new GatewayError(
        'Cashfree rejected the App ID / Secret Key. Check them in Admin > Payment Gateways (and that Test Mode matches the keys).',
        503
      );
    }
    throw new GatewayError(data.message || 'Cashfree returned an error.', 502);
  }
  return data;
}

export async function createOrder(config, {
  orderId,
  amount,
  customerId,
  customerPhone,
  customerEmail,
  customerName,
  returnUrl,
  notifyUrl,
  note,
}) {
  const customer = { customer_id: customerId, customer_phone: customerPhone };
  if (customerEmail) customer.customer_email = customerEmail;
  if (customerName && customerName.length >= 3) customer.customer_name = customerName.slice(0, 100);

  const meta = {};
  if (returnUrl) meta.return_url = returnUrl;
  // Cashfree only accepts HTTPS webhook URLs.
  if (notifyUrl && notifyUrl.startsWith('https://')) meta.notify_url = notifyUrl;

  const body = {
    order_id: orderId,
    order_amount: Number(Number(amount).toFixed(2)),
    order_currency: 'INR',
    customer_details: customer,
    order_meta: meta,
  };
  if (note && note.length >= 3) body.order_note = note.slice(0, 200);

  return request(config, 'POST', '/orders', body);
}

export async function fetchOrder(config, orderId) {
  return request(config, 'GET', `/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchOrderPayments(config, orderId) {
  const data = await request(config, 'GET', `/orders/${encodeURIComponent(orderId)}/payments`);
  return Array.isArray(data) ? data : [];
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// x-webhook-signature = base64(HMAC-SHA256(secret, timestamp + rawBody))
export function verifyWebhookSignature(config, rawBody, timestamp, signature) {
  if (!config || !rawBody || !timestamp || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  for (const payload of [`${timestamp}${body}`, `${timestamp}.${body}`]) {
    const expected = crypto.createHmac('sha256', config.secret).update(payload).digest('base64');
    if (safeEqual(expected, signature)) return true;
  }
  return false;
}

// Checks the saved credentials by asking Cashfree for an order that cannot
// exist: valid keys answer 404, bad keys answer 401.
export async function testCredentials(config) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}/orders/ENY_CONNECTION_TEST_${Date.now()}`, {
      headers: {
        'x-client-id': config.appId,
        'x-client-secret': config.secret,
        'x-api-version': API_VERSION,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    return { ok: false, message: 'Cashfree could not be reached from the server.' };
  }
  if (response.status === 404 || response.ok) {
    return { ok: true, message: `Connected to Cashfree (${config.mode}).` };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: `Cashfree rejected these keys in ${config.mode} mode. Check the App ID, the Secret Key and the Test Mode switch.`,
    };
  }
  return { ok: false, message: `Cashfree answered with status ${response.status}.` };
}
