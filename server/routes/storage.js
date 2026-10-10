// File storage on the server's own disk (replaces Supabase Storage).
//
//   POST /api/storage/upload/:bucket   multipart: file + path     (signed in)
//   POST /api/storage/sign/:bucket     { path, expiresIn }        (signed in)
//   GET  /api/storage/object/:bucket/<path>?token=...             (link holder)
//
// Files live in STORAGE_DIR (default: <project>/storage), outside the web
// root. They are only ever served through a signed link, so identity
// documents and evidence are not reachable by guessing a URL.

import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, generateUUID } from '../lib/mysql.js';
import { hasAdminAccess } from '../lib/auth.js';

const router = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '../../storage');

const MB = 1024 * 1024;
const BUCKETS = {
  evidence: { maxBytes: 25 * MB },
  'knowledge-base': { maxBytes: 25 * MB },
  'voice-recordings': { maxBytes: 25 * MB },
  'court-recordings': { maxBytes: 500 * MB },
};

// Total a single user may keep on the server (default 2 GB).
const USER_QUOTA_BYTES = (Number(process.env.STORAGE_USER_QUOTA_MB) || 2048) * MB;
const MAX_SIGN_SECONDS = 60 * 60 * 24 * 7;

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

// Types a browser may display in place. Everything else is sent as a download
// so an uploaded HTML or SVG file can never run as a page on this site.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(webm|mp4)|audio\/(webm|mpeg|mp4|wav|ogg))$/;

function bucketOf(name) {
  if (!Object.prototype.hasOwnProperty.call(BUCKETS, name)) return null;
  return BUCKETS[name];
}

// "a/b/../c d.png" -> "a/b/c_d.png"; null when nothing usable is left.
export function cleanPath(input) {
  if (typeof input !== 'string') return null;
  const segments = input
    .split(/[\\/]+/)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_'))
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.length > 12) return null;
  const joined = segments.join('/');
  return joined.length > 400 ? null : joined;
}

function diskPath(bucket, cleaned) {
  const root = path.join(STORAGE_DIR, bucket);
  const full = path.join(root, cleaned);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

export function signFileUrl(bucket, cleaned, expiresInSeconds) {
  const seconds = Math.min(Math.max(Number(expiresInSeconds) || 3600, 60), TEN_YEARS);
  const token = jwt.sign({ purpose: 'file', b: bucket, p: cleaned }, JWT_SECRET, { expiresIn: seconds });
  const encoded = cleaned.split('/').map(encodeURIComponent).join('/');
  return `/api/storage/object/${bucket}/${encoded}?token=${token}`;
}

const uploaders = {};
function uploaderFor(bucket) {
  if (!uploaders[bucket]) {
    uploaders[bucket] = multer({
      dest: path.join(os.tmpdir(), 'enyayasetu-uploads'),
      limits: { fileSize: BUCKETS[bucket].maxBytes, files: 1 },
    }).single('file');
  }
  return uploaders[bucket];
}

router.post('/upload/:bucket', authenticate, (req, res) => {
  const bucket = req.params.bucket;
  if (!bucketOf(bucket)) return res.status(404).json({ error: 'Unknown bucket' });

  uploaderFor(bucket)(req, res, async (uploadError) => {
    const tempFile = req.file && req.file.path;
    const discard = () => {
      if (tempFile) fs.promises.unlink(tempFile).catch(() => {});
    };

    try {
      if (uploadError) {
        const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({
          error: tooBig
            ? `File is too large. The limit is ${Math.round(BUCKETS[bucket].maxBytes / MB)} MB.`
            : 'Upload failed',
        });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const cleaned = cleanPath(req.body && req.body.path);
      const target = cleaned ? diskPath(bucket, cleaned) : null;
      if (!target) {
        discard();
        return res.status(400).json({ error: 'Invalid file path' });
      }

      const used = await queryOne(
        'SELECT COALESCE(SUM(size_bytes), 0) AS total FROM storage_objects WHERE owner_id = ?',
        [req.userId]
      );
      if (Number(used.total) + req.file.size > USER_QUOTA_BYTES) {
        discard();
        return res.status(413).json({ error: 'Your storage space is full. Please contact support.' });
      }

      const mimeType = String((req.body && req.body.contentType) || req.file.mimetype || 'application/octet-stream').slice(0, 150);

      // Claim the path in the index first: the unique key lets exactly one
      // uploader own a new path, so two people can never share a file slot.
      let existing = null;
      try {
        await query(
          `INSERT INTO storage_objects (id, bucket, path, owner_id, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [generateUUID(), bucket, cleaned, req.userId, mimeType, req.file.size]
        );
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        existing = await queryOne(
          'SELECT id, owner_id FROM storage_objects WHERE bucket = ? AND path = ?',
          [bucket, cleaned]
        );
        if (!existing || existing.owner_id !== req.userId) {
          discard();
          return res.status(409).json({ error: 'A file already exists at this path' });
        }
        await query('UPDATE storage_objects SET mime_type = ?, size_bytes = ? WHERE id = ?', [
          mimeType,
          req.file.size,
          existing.id,
        ]);
      }

      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.promises.rename(tempFile, target);
      } catch (renameError) {
        // Temp dir on another filesystem: copy instead.
        await fs.promises.copyFile(tempFile, target);
        discard();
      }

      res.json({ path: cleaned, fullPath: `${bucket}/${cleaned}`, publicUrl: signFileUrl(bucket, cleaned, TEN_YEARS) });
    } catch (error) {
      discard();
      console.error('[Storage] upload failed:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

// Who may get a link to a stored file: its uploader, an admin, or - for files
// filed under a court session id - anyone taking part in that session.
async function canRead(object, cleaned, req) {
  if (object.owner_id === req.userId) return true;
  if (await hasAdminAccess(req.userId, req.tfaVerified === true)) return true;
  const firstSegment = cleaned.split('/')[0];
  const session = await queryOne(
    `SELECT cs.id FROM court_sessions cs
     LEFT JOIN cases c ON c.id = cs.case_id
     WHERE cs.id = ? AND (c.user_id = ? OR EXISTS (
       SELECT 1 FROM court_participants cp WHERE cp.session_id = cs.id AND cp.user_id = ?))`,
    [firstSegment, req.userId, req.userId]
  );
  return !!session;
}

router.post('/sign/:bucket', authenticate, async (req, res) => {
  try {
    const bucket = req.params.bucket;
    if (!bucketOf(bucket)) return res.status(404).json({ error: 'Unknown bucket' });
    const cleaned = cleanPath(req.body && req.body.path);
    if (!cleaned) return res.status(400).json({ error: 'Invalid file path' });

    const object = await queryOne(
      'SELECT id, owner_id FROM storage_objects WHERE bucket = ? AND path = ?',
      [bucket, cleaned]
    );
    if (!object || !(await canRead(object, cleaned, req))) {
      return res.status(404).json({ error: 'File not found' });
    }
    const seconds = Math.min(Number(req.body && req.body.expiresIn) || 3600, MAX_SIGN_SECONDS);
    res.json({ signedUrl: signFileUrl(bucket, cleaned, seconds) });
  } catch (error) {
    console.error('[Storage] sign failed:', error);
    res.status(500).json({ error: 'Could not create a link' });
  }
});

router.get('/object/:bucket/*', async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const cleaned = cleanPath(req.params[0]);
    if (!bucketOf(bucket) || !cleaned) return res.status(404).end();

    let claims;
    try {
      claims = jwt.verify(String(req.query.token || ''), JWT_SECRET);
    } catch (error) {
      return res.status(403).json({ error: 'This link has expired or is not valid.' });
    }
    if (claims.purpose !== 'file' || claims.b !== bucket || claims.p !== cleaned) {
      return res.status(403).json({ error: 'This link has expired or is not valid.' });
    }

    const object = await queryOne(
      'SELECT mime_type FROM storage_objects WHERE bucket = ? AND path = ?',
      [bucket, cleaned]
    );
    const full = diskPath(bucket, cleaned);
    if (!object || !full || !fs.existsSync(full)) return res.status(404).end();

    const mimeType = object.mime_type || 'application/octet-stream';
    const inline = INLINE_TYPES.test(mimeType);
    res.setHeader('Content-Type', inline ? mimeType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${path.basename(cleaned)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(full, { headers: {}, dotfiles: 'deny' });
  } catch (error) {
    console.error('[Storage] download failed:', error);
    res.status(500).end();
  }
});

export default router;
