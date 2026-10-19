// Express.js API Server entry point (systemd / pm2 run this file).
// The application itself lives in server/app.js.

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

import app from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.API_PORT || 3000;

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const { query } = await import('./lib/mysql.js');
    const result = await query('SELECT 1 as test');
    console.log('✅ Database connection verified');
    // Analyses cannot survive a restart; mark them so users can re-run them.
    const { recoverInterruptedAnalyses } = await import('./lib/case-prep/repo.js');
    await recoverInterruptedAnalyses().catch((e) => console.warn('Case-prep recovery skipped:', e.message));
  } catch (error) {
    console.error('❌ Database connection failed on startup:', error.message);
    console.error('   Server will start but API calls will fail until database is accessible');
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${path.join(__dirname, '../public/uploads')}`);
  const { storageStatus } = await import('./lib/case-prep/storage.js');
  const storage = storageStatus();
  if (!storage.ready) console.warn(`⚠️  Case-prep uploads disabled: ${storage.error}`);
  else if (!storage.encrypted) console.warn('⚠️  Case-prep documents are stored unencrypted (set CASE_PREP_ENCRYPTION_KEY).');
  console.log('');
  await testDatabaseConnection();
});

export default app;

