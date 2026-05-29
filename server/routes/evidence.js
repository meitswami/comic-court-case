// Evidence Routes
// Handles evidence-related endpoints

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, insert } from '../lib/mysql.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
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
    const fileUrl = `/uploads/evidence/${req.file.filename}`;

    const evidenceId = require('crypto').randomUUID();
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

// OCR Document (from ocr-document Edge Function)
router.post('/ocr', authenticate, async (req, res) => {
  try {
    // TODO: Implement OCR logic
    res.json({ message: 'OCR endpoint - to be implemented' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

