// Cashfree checkout (browser side).
//
// The server creates the order and returns a `payment_session_id`. Here we
// load Cashfree's script and send the customer to Cashfree's hosted payment
// page. When they finish, Cashfree brings them back to /payment/return, where
// the server confirms the payment before anything is delivered.

import { apiFetch } from '@/lib/api';

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';
const RETURN_KEY = 'eny_payment_return';
const PHONE_KEY = 'eny_payment_phone';

declare global {
  interface Window {
    Cashfree?: (options: { mode: string }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget?: string }) => Promise<any>;
    };
  }
}

export interface ActiveGateway {
  gateway: 'cashfree' | null;
  mode?: 'sandbox' | 'production';
}

export interface PendingGatewayPayment {
  payment_id: string;
  payment_session_id: string;
  cashfree_mode: 'sandbox' | 'production';
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        sdkPromise = null;
        script.remove();
        reject(new Error('Could not load the payment page. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

// Which online gateway the admin has switched on, if any.
export async function fetchActiveGateway(): Promise<ActiveGateway> {
  try {
    const data = await apiFetch<ActiveGateway>('/payments/gateway');
    return data?.gateway === 'cashfree' ? data : { gateway: null };
  } catch {
    return { gateway: null };
  }
}

export function isValidIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''));
}

export function rememberedPhone(): string {
  try {
    return localStorage.getItem(PHONE_KEY) || '';
  } catch {
    return '';
  }
}

export function rememberPhone(phone: string) {
  try {
    localStorage.setItem(PHONE_KEY, phone);
  } catch {
    // not essential
  }
}

// Sends the customer to Cashfree. The page navigates away, so this normally
// does not return; it throws if the payment page could not be opened.
export async function redirectToCashfree(payment: PendingGatewayPayment): Promise<void> {
  if (!payment?.payment_session_id) throw new Error('The payment could not be started. Please try again.');
  await loadSdk();
  if (!window.Cashfree) throw new Error('Could not load the payment page. Please try again.');

  try {
    sessionStorage.setItem(
      RETURN_KEY,
      JSON.stringify({
        payment_id: payment.payment_id,
        path: `${window.location.pathname}${window.location.search}`,
      })
    );
  } catch {
    // The return page still works from the order id in its URL.
  }

  const cashfree = window.Cashfree({ mode: payment.cashfree_mode === 'production' ? 'production' : 'sandbox' });
  const result = await cashfree.checkout({
    paymentSessionId: payment.payment_session_id,
    redirectTarget: '_self',
  });
  if (result?.error) {
    throw new Error(result.error.message || 'The payment page could not be opened.');
  }
}

export function takeReturnContext(): { payment_id?: string; path?: string } {
  try {
    const stored = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export interface PaymentOutcome {
  payment_id: string;
  status: 'completed' | 'pending' | 'processing' | 'failed' | 'cancelled' | 'refunded';
  type: 'hearing_payment' | 'wallet_topup' | 'addon_payment';
  amount: number;
  session: { id: string; court_code: string } | null;
  invoice_number: string | null;
}

// Asks the server (which asks Cashfree) whether the order was paid. Retries
// for a short while because confirmation can lag the redirect by a moment.
export async function confirmCashfreePayment(
  reference: { order_id?: string; payment_id?: string },
  attempts = 6
): Promise<PaymentOutcome> {
  let last: PaymentOutcome | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await apiFetch<PaymentOutcome>('/payments/cashfree/verify', { body: reference });
    if (last.status !== 'pending' && last.status !== 'processing') return last;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return last as PaymentOutcome;
}
