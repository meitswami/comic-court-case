// AI Routes
//
// Older paths kept for compatibility. The real implementations live in
// server/routes/functions.js (POST /api/functions/<name>).

import express from 'express';
import functionRoutes from './functions.js';

const router = express.Router();

const ALIASES = {
  '/judge': '/ai-judge',
  '/case-intake-chat': '/case-intake-chat',
  '/court-chat': '/court-chat',
};

router.post(Object.keys(ALIASES), (req, res, next) => {
  req.url = ALIASES[req.path];
  functionRoutes(req, res, next);
});

export default router;
