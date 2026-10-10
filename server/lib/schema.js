// Table/column metadata for the generic data API (server/routes/data.js).
//
// Loaded once from information_schema so the data API can:
//   - reject any table or column name that does not exist (nothing a client
//     sends is ever interpolated into SQL without passing this check)
//   - convert values between MySQL/MariaDB and the JSON the frontend expects
//     (booleans, decimals, dates, JSON columns)

import { query } from './mysql.js';

// JSON columns. MySQL reports these as DATA_TYPE 'json'; MariaDB stores JSON
// as LONGTEXT, so the names are listed here as well.
const JSON_COLUMNS = new Set([
  'raw_user_meta_data',
  'metadata',
  'invoice_data',
  'features',
  'analysis_data',
  'analyzed_documents',
  'backup_codes',
  'addons_applied',
  'related_transcript_log_ids',
  'processing_result',
]);

let cache = null;
let limits = {};
let loading = null;

function kindOf(dataType, columnType, name) {
  const d = String(dataType || '').toLowerCase();
  const ct = String(columnType || '').toLowerCase();
  if (ct === 'tinyint(1)' || d === 'bit' || d === 'boolean') return 'bool';
  if (d === 'json' || JSON_COLUMNS.has(name)) return 'json';
  if (d === 'decimal' || d === 'float' || d === 'double') return 'number';
  if (d === 'datetime' || d === 'timestamp') return 'datetime';
  if (d === 'date') return 'date';
  if (d === 'char' || d === 'varchar' || d === 'enum' || d === 'set' || d.endsWith('text')) return 'string';
  if (d.endsWith('int') || d === 'year') return 'int';
  return 'other';
}

async function load() {
  const rows = await query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d, COLUMN_TYPE AS ct,
            CHARACTER_MAXIMUM_LENGTH AS len
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()`
  );
  const schema = {};
  const lengths = {};
  for (const row of rows) {
    const table = row.t;
    if (!schema[table]) {
      schema[table] = {};
      lengths[table] = {};
    }
    schema[table][row.c] = kindOf(row.d, row.ct, row.c);
    const type = String(row.d || '').toLowerCase();
    if ((type === 'varchar' || type === 'char') && row.len) {
      lengths[table][row.c] = Number(row.len);
    }
  }
  limits = lengths;
  return schema;
}

export async function getSchema() {
  if (cache) return cache;
  if (!loading) {
    loading = load()
      .then((schema) => {
        cache = schema;
        return schema;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

// Call after running migrations in the same process (tests) to pick up changes.
export function resetSchemaCache() {
  cache = null;
}

export async function getColumns(table) {
  const schema = await getSchema();
  return schema[table] || null;
}

// Maximum length of a VARCHAR/CHAR column, or null when it has none.
export function maxLength(table, column) {
  return (limits[table] && limits[table][column]) || null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// DB row -> JSON-safe row
export function decodeRow(row, columns) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const kind = columns[key];
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (kind === 'bool') {
      out[key] = Buffer.isBuffer(value) ? value[0] === 1 : Number(value) === 1;
    } else if (kind === 'number') {
      const n = Number(value);
      out[key] = Number.isNaN(n) ? value : n;
    } else if (kind === 'json') {
      if (typeof value === 'string') {
        try {
          out[key] = JSON.parse(value);
        } catch (error) {
          out[key] = value;
        }
      } else {
        out[key] = value;
      }
    } else if (kind === 'date' && value instanceof Date) {
      out[key] = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

// JSON value -> value safe to bind for the given column
export function encodeValue(value, kind) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (kind === 'bool') {
    if (typeof value === 'string') return value === 'true' || value === '1' ? 1 : 0;
    return value ? 1 : 0;
  }
  if (kind === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  if (kind === 'datetime') {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && ISO_DATETIME.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return value;
  }
  if (kind === 'date') {
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
    return value;
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    // Object sent for a plain column: store it as JSON text instead of failing.
    return JSON.stringify(value);
  }
  // Always compare and store text as text. Binding a number against a text
  // column would make MySQL compare numerically ('abc' = 0 is true).
  if (kind === 'string' && typeof value !== 'string') return String(value);
  if ((kind === 'int' || kind === 'number') && typeof value !== 'number') {
    const n = Number(value);
    return Number.isFinite(n) && String(value).trim() !== '' ? n : null;
  }
  return value;
}
