// Express.js API Server
// Replaces Supabase Edge Functions

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Verify database configuration on startup
console.log('📊 Database Configuration:');
console.log('   Host:', process.env.DB_HOST || 'NOT SET');
console.log('   Port:', process.env.DB_PORT || '3306 (default, not specified)');
console.log('   User:', process.env.DB_USER || 'NOT SET');
console.log('   Database:', process.env.DB_NAME || 'NOT SET');
console.log('   Password:', process.env.DB_PASSWORD ? '***' : 'NOT SET');
console.log('   SSL:', process.env.DB_HOST && process.env.DB_HOST.includes('hstgr.io') ? 'Enabled' : 'Disabled');
console.log('');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
// Behind nginx: trust X-Forwarded-* so req.protocol / req.ip are the client's.
app.set('trust proxy', 1);
app.use(express.json({
  limit: '25mb',
  // The Cashfree webhook signature is computed over the exact bytes received.
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/payments/cashfree/webhook')) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files. They are user content: never let a browser run one
// as a page on this site.
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  },
}));

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
import dataRoutes from './routes/data.js';
import functionRoutes from './routes/functions.js';
import storageRoutes from './routes/storage.js';
import realtimeRoutes from './routes/realtime.js';
import adminRoutes from './routes/admin.js';

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
app.use('/api/data', dataRoutes);
app.use('/api/functions', functionRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/admin', adminRoutes);

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

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const { query } = await import('./lib/mysql.js');
    const result = await query('SELECT 1 as test');
    console.log('✅ Database connection verified');
  } catch (error) {
    console.error('❌ Database connection failed on startup:', error.message);
    console.error('   Server will start but API calls will fail until database is accessible');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${path.join(__dirname, '../public/uploads')}`);
  console.log('');
  await testDatabaseConnection();
});

export default app;

