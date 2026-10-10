// Transactional email through Resend. The API key is set by a Super Admin
// (Admin > Settings) or via RESEND_API_KEY.

import { getSetting } from './settings.js';

export class EmailError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function isEmailConfigured() {
  return !!(await getSetting('RESEND_API_KEY'));
}

export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail({ to, subject, html, apiKey }) {
  const key = apiKey || (await getSetting('RESEND_API_KEY'));
  if (!key) {
    throw new EmailError(
      'Email is not configured. A Super Admin needs to add a Resend API key in Admin > Settings.',
      503
    );
  }
  const from = (await getSetting('EMAIL_FROM')) || 'eNyayaSetu <onboarding@resend.dev>';

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new EmailError('The email service could not be reached.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EmailError(data.message || 'Failed to send email', response.status === 401 ? 503 : 502);
  }
  return data;
}
