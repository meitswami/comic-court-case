// Express application (routes + middleware).
// Kept separate from server/index.js (which starts listening) so tests can
// exercise the API without opening a port.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Import routes
import authRoutes from './routes/auth.js';
import caseRoutes from './routes/cases.js';
import paymentRoutes from './routes/payments.js';
import aiRoutes from './routes/ai.js';
import evidenceRoutes from './routes/evidence.js';
import courtRoutes from './routes/court.js';
import invoiceRoutes from './routes/invoices.js';
import addonRoutes from './routes/addons.js';
import caseStrengthRoutes from './routes/case-strength.js';
import rtiRoutes from './routes/rti.js';
import authenticatorRoutes from './routes/authenticator.js';
import casePrepRoutes from './routes/case-prep.js';

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/court', courtRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/addons', addonRoutes);
app.use('/api/case-strength', caseStrengthRoutes);
app.use('/api/rti', rtiRoutes);
app.use('/api/authenticator', authenticatorRoutes);
app.use('/api/case-prep', casePrepRoutes);

// Root API endpoint (informational)
app.get('/api', (req, res) => {
  res.json({
    message: 'API Server is running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      cases: '/api/cases',
      payments: '/api/payments',
      addons: '/api/addons',
      caseStrength: '/api/case-strength',
      rti: '/api/rti',
      casePrep: '/api/case-prep',
    },
    timestamp: new Date().toISOString()
  });
});

// Health check (also under /api so it is reachable through the /api proxy)
const healthCheck = (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', healthCheck);
app.get('/api/health', healthCheck);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

export default app;
