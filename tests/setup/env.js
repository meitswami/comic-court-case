// Test environment. Runs before every test file, before app modules load.
//
// Integration tests use a real MySQL/MariaDB database. Point them at one with
//   TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME
// The database must already have every file in mysql/migrations/ applied
// (scripts/apply-test-migrations.sh does this). Never point these at production.
import crypto from 'crypto';
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'enyaya';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'enyaya_test_pw';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'enyayasetu_test';
process.env.JWT_SECRET = 'test-secret-' + crypto.randomBytes(16).toString('hex');
process.env.CASE_PREP_STORAGE_DIR = path.join(os.tmpdir(), `case-prep-test-${process.pid}-${Date.now()}`);
process.env.CASE_PREP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

// No AI provider unless a test configures one explicitly. Empty strings (not
// deletes) so a developer's .env cannot leak a real provider key into tests:
// dotenv never overrides variables that are already set.
for (const key of ['AI_API_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_VISION', 'LOVABLE_API_KEY', 'OLLAMA_ENDPOINT', 'OLLAMA_MODEL']) {
  process.env[key] = '';
}
