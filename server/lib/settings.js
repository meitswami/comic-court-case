// Integration settings (API keys for AI, voice and email).
//
// A Super Admin saves these from the admin console; they are stored in the
// `app_settings` table. If a key has not been saved there, the matching
// environment variable is used instead, so existing .env setups keep working.

import { query } from './mysql.js';

// key -> { secret, label }
export const SETTING_KEYS = {
  AI_API_KEY: { secret: true, label: 'AI API key' },
  AI_API_URL: { secret: false, label: 'AI API URL' },
  AI_MODEL: { secret: false, label: 'AI model' },
  ELEVENLABS_API_KEY: { secret: true, label: 'ElevenLabs API key' },
  RESEND_API_KEY: { secret: true, label: 'Resend API key' },
  EMAIL_FROM: { secret: false, label: 'Email sender' },
};

const CACHE_MS = 30 * 1000;
let cache = null;
let cachedAt = 0;

async function loadAll() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const values = {};
  try {
    const rows = await query('SELECT setting_key, setting_value FROM app_settings');
    for (const row of rows) {
      if (row.setting_value !== null && row.setting_value !== '') {
        values[row.setting_key] = row.setting_value;
      }
    }
  } catch (error) {
    // Table missing (migration not run yet): fall back to environment only.
    if (error.code !== 'ER_NO_SUCH_TABLE') {
      console.error('[Settings] Could not load app_settings:', error.message);
    }
  }
  cache = values;
  cachedAt = Date.now();
  return values;
}

export async function getSetting(key) {
  const values = await loadAll();
  if (values[key]) return values[key];
  return process.env[key] || null;
}

export async function setSetting(key, value, userId) {
  if (!Object.prototype.hasOwnProperty.call(SETTING_KEYS, key)) {
    throw new Error('Unknown setting');
  }
  const clean = value === null || value === undefined ? '' : String(value).trim();
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, is_secret, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value),
                             is_secret = VALUES(is_secret),
                             updated_by = VALUES(updated_by)`,
    [key, clean === '' ? null : clean, SETTING_KEYS[key].secret ? 1 : 0, userId || null]
  );
  cache = null;
}

// For the admin console: which settings are configured, never the secrets.
export async function describeSettings() {
  const stored = await loadAll();
  const out = {};
  for (const [key, meta] of Object.entries(SETTING_KEYS)) {
    const fromDb = stored[key] || null;
    const fromEnv = process.env[key] || null;
    const value = fromDb || fromEnv;
    out[key] = {
      label: meta.label,
      secret: meta.secret,
      configured: !!value,
      source: fromDb ? 'admin' : fromEnv ? 'env' : null,
      value: meta.secret ? null : value,
      hint: meta.secret && value ? `••••${String(value).slice(-4)}` : null,
    };
  }
  return out;
}
