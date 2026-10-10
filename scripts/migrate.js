// Database upgrade for the "run everything on our own server" release.
//
//   node scripts/migrate.js        (or: npm run migrate)
//
// Safe to run more than once: every step first checks whether it is already
// done. Works on both MySQL 8 and MariaDB, which is why this is a script and
// not a .sql file (the two disagree on "ADD COLUMN IF NOT EXISTS").
//
// What it does:
//   0. Repairs the schema where an earlier numbered migration stopped half-way
//      (002 and 007 use "ADD COLUMN IF NOT EXISTS", which MySQL 8 rejects).
//      On a database where they ran fully this step changes nothing.
//   1. Removes two triggers on payment_gateway_settings that made it
//      impossible to activate a gateway (they updated their own table).
//   2. Adds 'cashfree' as a payment gateway.
//   3. Lets notifications use any type name (the app uses more than the old
//      ENUM allowed, so those inserts failed).
//   4. Creates app_settings (API keys saved from the admin console).
//   5. Creates storage_objects (index of uploaded files).

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'enyayasetu',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  ssl: process.env.DB_HOST && process.env.DB_HOST.includes('hstgr.io') ? { rejectUnauthorized: false } : undefined,
};

const GATEWAYS = "'razorpay', 'phonepe', 'cashfree', 'wallet', 'manual'";

async function main() {
  const db = await mysql.createConnection(config);
  const log = (message) => console.log(`  ${message}`);

  const [[version]] = await db.query('SELECT VERSION() AS v');
  console.log(`Connected to ${config.database} on ${config.host} (${version.v})`);

  const tableExists = async (table) => {
    const [rows] = await db.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table]
    );
    return rows.length > 0;
  };

  const columnType = async (table, column) => {
    const [rows] = await db.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    return rows.length ? String(rows[0].t) : null;
  };

  for (const required of ['users', 'payments', 'payment_gateway_settings', 'court_sessions', 'notifications']) {
    if (!(await tableExists(required))) {
      throw new Error(
        `Table "${required}" is missing. Apply mysql/migrations/001 to 011 first, then run this again.`
      );
    }
  }

  const ensureColumn = async (table, column, definition) => {
    if (!(await tableExists(table))) return false;
    if ((await columnType(table, column)) !== null) return false;
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    log(`${table}.${column}: added`);
    return true;
  };

  console.log('0. Schema repair');
  let repaired = 0;
  const caseColumns = [
    ['callback_number', 'VARCHAR(50)'],
    ['processing_eta', 'DATETIME'],
    ['ai_processing_status', "VARCHAR(50) DEFAULT 'pending'"],
    ['uploaded_by_relation', 'VARCHAR(100)'],
    ['involved_person_status', 'VARCHAR(100)'],
  ];
  for (const [column, definition] of caseColumns) {
    if (await ensureColumn('cases', column, definition)) repaired += 1;
  }

  for (const [table, ddl] of [
    ['case_intake_messages', `CREATE TABLE IF NOT EXISTS case_intake_messages (
       id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
       case_id CHAR(36),
       user_id CHAR(36) NOT NULL,
       role ENUM('user', 'assistant', 'system') NOT NULL,
       message TEXT NOT NULL,
       message_type ENUM('text', 'voice', 'file_upload', 'ocr_result') DEFAULT 'text',
       voice_recording_url TEXT,
       file_url TEXT,
       ocr_extracted_text TEXT,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
       INDEX idx_case_id (case_id),
       INDEX idx_user_id (user_id),
       INDEX idx_created_at (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
    ['case_reports', `CREATE TABLE IF NOT EXISTS case_reports (
       id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
       case_id CHAR(36) NOT NULL,
       report_type ENUM('fir', 'sir', 'fr', 'chargesheet', 'other') NOT NULL,
       file_name VARCHAR(255) NOT NULL,
       file_url TEXT NOT NULL,
       file_type VARCHAR(100) NOT NULL,
       ocr_text TEXT,
       ai_summary TEXT,
       uploaded_by CHAR(36),
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
       FOREIGN KEY (uploaded_by) REFERENCES users(id),
       INDEX idx_case_id (case_id),
       INDEX idx_uploaded_by (uploaded_by)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  ]) {
    if (!(await tableExists(table))) {
      await db.query(ddl);
      log(`${table}: created`);
      repaired += 1;
    }
  }

  const sessionColumns = [
    ['payment_status', "ENUM('pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled') DEFAULT 'pending'"],
    ['payment_id', 'CHAR(36)'],
    ['invoice_id', 'CHAR(36)'],
    ['court_hearing_fee', 'DECIMAL(10, 2) DEFAULT 1200.00'],
    ['lawyer_type', "ENUM('ai_lawyer', 'actual_lawyer')"],
    ['ai_lawyer_fee', 'DECIMAL(10, 2) DEFAULT 500.00'],
    ['actual_lawyer_fee', 'DECIMAL(10, 2)'],
    ['actual_lawyer_id', 'VARCHAR(255)'],
    ['actual_lawyer_email', 'VARCHAR(255)'],
    ['actual_lawyer_otp', 'VARCHAR(10)'],
    ['actual_lawyer_otp_expires_at', 'DATETIME'],
    ['actual_lawyer_consultation_requested', 'BOOLEAN DEFAULT FALSE'],
    ['actual_lawyer_callback_number', 'VARCHAR(50)'],
    ['total_fee', 'DECIMAL(10, 2) DEFAULT 1200.00'],
    ['payment_method', `ENUM(${GATEWAYS})`],
    ['hearing_started', 'BOOLEAN DEFAULT FALSE'],
  ];
  for (const [column, definition] of sessionColumns) {
    if (await ensureColumn('court_sessions', column, definition)) repaired += 1;
  }

  // Add-ons the app sells. Purchases unlock a feature by matching these codes,
  // so the rows have to exist.
  if (await tableExists('addons')) {
    const catalogue = [
      {
        code: 'ai_lawyer_assistant',
        name: 'AI Lawyer Assistant',
        description:
          'Extra support for AI lawyer with deep search, OCR reading and understanding of case documents, media, and evidences. Includes Hash Value generation as per Indian Law Section 63(4)C for digital evidences.',
        price: 250,
        features: [
          'Deep case analysis',
          'Enhanced OCR processing',
          'Document understanding',
          'Evidence hash generation (Section 63(4)C)',
          'Advanced legal research',
        ],
      },
      {
        code: 'case-strength-suggestions',
        name: 'Case Strength Improvement Suggestions',
        description:
          'Get personalized AI-powered suggestions to strengthen your case. Learn what documents and evidence you need to improve your case strength percentage.',
        price: 200,
        features: [
          'Personalized improvement suggestions',
          'Missing document recommendations',
          'Impact percentage for each suggestion',
          'Estimated case strength after improvements',
          'Priority-based recommendations',
        ],
      },
      {
        code: 'rti-tutorial',
        name: 'RTI Tutorial & Application',
        description:
          'Complete guided tutorial on Right to Information (RTI) Act. Learn how to apply for RTI and apply directly from the platform.',
        price: 50,
        features: [
          'Complete RTI Act tutorial',
          'Step-by-step application guide',
          'Direct RTI application form',
          'Track application progress',
          'Learn about RTI fees and appeals',
        ],
      },
    ];
    for (const addon of catalogue) {
      const [found] = await db.query('SELECT id FROM addons WHERE code = ?', [addon.code]);
      if (found.length === 0) {
        await db.query(
          `INSERT INTO addons (id, code, name, description, price, status, max_per_case, features)
           VALUES (UUID(), ?, ?, ?, ?, 'active', 1, ?)`,
          [addon.code, addon.name, addon.description, addon.price, JSON.stringify({ features: addon.features })]
        );
        log(`addons: "${addon.name}" created (Rs ${addon.price})`);
        repaired += 1;
      }
    }
  }
  if (repaired === 0) log('nothing to repair');

  console.log('1. Gateway triggers');
  for (const trigger of [
    'enforce_single_active_gateway_before_insert',
    'enforce_single_active_gateway_before_update',
  ]) {
    await db.query(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  log('removed (the server now keeps a single gateway active)');

  console.log('2. Cashfree gateway');
  const enums = [
    ['payment_gateway_settings', 'gateway', `ENUM(${GATEWAYS}) NOT NULL`],
    ['payments', 'gateway', `ENUM(${GATEWAYS}) NOT NULL`],
    ['court_sessions', 'payment_method', `ENUM(${GATEWAYS}) NULL`],
  ];
  for (const [table, column, definition] of enums) {
    const current = await columnType(table, column);
    if (current === null) {
      log(`${table}.${column}: column not found, skipped`);
    } else if (current.includes("'cashfree'")) {
      log(`${table}.${column}: already allows cashfree`);
    } else {
      await db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${definition}`);
      log(`${table}.${column}: cashfree added`);
    }
  }
  const [existing] = await db.query("SELECT id FROM payment_gateway_settings WHERE gateway = 'cashfree'");
  if (existing.length === 0) {
    await db.query(
      "INSERT INTO payment_gateway_settings (id, gateway, is_active, test_mode) VALUES (UUID(), 'cashfree', 0, 1)"
    );
    log('cashfree settings row created (inactive, test mode)');
  } else {
    log('cashfree settings row already present');
  }

  console.log('3. Notification types');
  const notificationType = await columnType('notifications', 'type');
  if (notificationType && notificationType.toLowerCase().startsWith('enum')) {
    await db.query("ALTER TABLE notifications MODIFY COLUMN `type` VARCHAR(50) NOT NULL DEFAULT 'info'");
    log('notifications.type changed to VARCHAR(50)');
  } else {
    log('already flexible');
  }

  console.log('4. app_settings');
  await db.query(
    `CREATE TABLE IF NOT EXISTS app_settings (
       setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
       setting_value TEXT,
       is_secret BOOLEAN NOT NULL DEFAULT FALSE,
       updated_by CHAR(36),
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  log('ready');

  console.log('5. storage_objects');
  await db.query(
    `CREATE TABLE IF NOT EXISTS storage_objects (
       id CHAR(36) NOT NULL PRIMARY KEY,
       bucket VARCHAR(64) NOT NULL,
       path VARCHAR(400) NOT NULL,
       owner_id CHAR(36),
       mime_type VARCHAR(150),
       size_bytes BIGINT NOT NULL DEFAULT 0,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY unique_bucket_path (bucket, path),
       INDEX idx_owner (owner_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  log('ready');

  await db.end();
  console.log('\nDone. Restart the API so it picks up the new tables.');
}

main().catch((error) => {
  console.error('\nMigration failed:', error.message);
  process.exit(1);
});
