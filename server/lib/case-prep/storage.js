// Private storage for case-preparation documents.
//
// - Files live outside public/ (default: <repo>/storage/case-prep), so the
//   static /uploads handler can never serve them. They are read back only
//   through the authorised API route.
// - Storage keys are random; the original filename never touches the disk.
// - With CASE_PREP_ENCRYPTION_KEY set (32 bytes, base64 or hex), files are
//   encrypted with AES-256-GCM. In production the key is mandatory: uploads
//   are refused rather than stored in plaintext.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, '../../../storage/case-prep');
const MAGIC = Buffer.from('ENYS1'); // marks an encrypted file: MAGIC | iv(12) | tag(16) | ciphertext

export class StorageConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'STORAGE_NOT_CONFIGURED';
  }
}

export function storageDir() {
  return process.env.CASE_PREP_STORAGE_DIR ? path.resolve(process.env.CASE_PREP_STORAGE_DIR) : DEFAULT_DIR;
}

export function parseKey(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try {
      key = Buffer.from(value, 'base64');
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    throw new StorageConfigError('CASE_PREP_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).');
  }
  return key;
}

function encryptionKey() {
  return parseKey(process.env.CASE_PREP_ENCRYPTION_KEY);
}

export function storageStatus() {
  let encrypted = false;
  let error = null;
  try {
    encrypted = Boolean(encryptionKey());
  } catch (e) {
    error = e.message;
  }
  const production = process.env.NODE_ENV === 'production';
  return {
    encrypted,
    ready: !error && (encrypted || !production),
    error: error || (!encrypted && production ? 'CASE_PREP_ENCRYPTION_KEY is required in production.' : null),
  };
}

export function encryptBuffer(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(stored, key) {
  if (!stored.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Stored file is not in the encrypted format');
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = stored.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const body = stored.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function keyToPath(storageKey) {
  if (!/^[a-f0-9-]{36}$/.test(storageKey)) throw new Error('Invalid storage key');
  return path.join(storageDir(), storageKey.slice(0, 2), storageKey);
}

/** Store a buffer; returns { storageKey, encrypted }. */
export async function saveFile(buffer) {
  const status = storageStatus();
  if (!status.ready) throw new StorageConfigError(status.error);
  const key = encryptionKey();
  const storageKey = crypto.randomUUID();
  const filePath = keyToPath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const data = key ? encryptBuffer(buffer, key) : buffer;
  await fs.writeFile(filePath, data, { mode: 0o600, flag: 'wx' });
  return { storageKey, encrypted: Boolean(key) };
}

export async function readFile(storageKey, encrypted) {
  const data = await fs.readFile(keyToPath(storageKey));
  if (!encrypted) return data;
  const key = encryptionKey();
  if (!key) throw new StorageConfigError('File is encrypted but CASE_PREP_ENCRYPTION_KEY is not set.');
  return decryptBuffer(data, key);
}

export async function deleteFile(storageKey) {
  try {
    await fs.unlink(keyToPath(storageKey));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
