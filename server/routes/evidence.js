// Evidence Routes
// Handles evidence-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert, generateUUID } from '../lib/mysql.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.mp4', '.webm', '.wav', '.txt', '.doc', '.docx'];

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/evidence');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Never trust the uploaded name: keep only a known-safe extension.
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '.bin';
    cb(null, `${Date.now()}-${generateUUID()}${safeExt}`);
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Upload evidence (from analyze-evidence Edge Function)
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { case_id, provided_by, description } = req.body;

    const ownCase = await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [case_id, req.userId]);
    if (!ownCase) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: 'You can only add evidence to your own case.' });
    }

    const fileUrl = `/uploads/evidence/${req.file.filename}`;

    const evidenceId = generateUUID();
    await insert('case_evidence', {
      id: evidenceId,
      case_id,
      file_name: req.file.originalname,
      file_type: req.file.mimetype,
      file_url: fileUrl,
      provided_by,
      description,
      uploaded_by: req.userId,
    });

    const evidence = await queryOne('SELECT * FROM case_evidence WHERE id = ?', [evidenceId]);
    res.json(evidence);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

