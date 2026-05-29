// MySQL Client (server-side, plain JS)
// Vercel's @vercel/node runtime cannot resolve `.ts` imports across
// directories, so this is the canonical server-side copy that all
// Express routes and middleware import from.
//
// Behaviour mirrors src/integrations/mysql/client.ts so that the local
// `npm run server` (tsx) and Vercel serverless runtime stay consistent.

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// SSL configuration for Hostinger (required for remote connections)
const sslConfig = process.env.DB_HOST && process.env.DB_HOST.includes('hstgr.io')
  ? { rejectUnauthorized: false } // Hostinger uses self-signed certificates
  : false;

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'enyayasetu',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000,
  ssl: sslConfig,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
};

console.log('MySQL pool configured for', poolConfig.host + ':' + poolConfig.port,
  '(ssl=' + (sslConfig ? 'on' : 'off') + ')');

const pool = mysql.createPool(poolConfig);

export async function query(sql, params) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('MySQL query error:', error.message);
    console.error('SQL:', sql);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('Database connection failed. Check DB_HOST/PORT/USER/PASSWORD/NAME env vars.');
    }
    throw error;
  }
}

export async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function insert(table, data) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const [result] = await pool.execute(sql, values);
  return { insertId: result.insertId };
}

export async function update(table, data, where) {
  const setClause = Object.keys(data).map((key) => `${key} = ?`).join(', ');
  const whereClause = Object.keys(where).map((key) => `${key} = ?`).join(' AND ');
  const values = [...Object.values(data), ...Object.values(where)];
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
  const [result] = await pool.execute(sql, values);
  return { affectedRows: result.affectedRows };
}

export async function remove(table, where) {
  const whereClause = Object.keys(where).map((key) => `${key} = ?`).join(' AND ');
  const values = Object.values(where);
  const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
  const [result] = await pool.execute(sql, values);
  return { affectedRows: result.affectedRows };
}

export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function closePool() {
  await pool.end();
}

export { pool };
