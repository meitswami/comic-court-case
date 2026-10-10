// Generic data API
//
// The frontend talks to the database through a small query-builder client
// (src/integrations/supabase/client.ts) that used to point at Supabase. This
// route is what that client calls now. It turns a described query into SQL for
// MySQL, with three safeguards:
//
//   1. Only tables listed in server/lib/dataPolicies.js are reachable.
//   2. Every table and column name is checked against the real schema, and
//      every value is bound as a parameter - nothing from the request is ever
//      concatenated into SQL.
//   3. The table's policy limits which rows the caller can read or change.
//
//   POST /api/data/query   select | insert | update | delete
//   POST /api/data/rpc     named server-side procedures
//   POST /api/data/watch   change detection for "realtime" subscriptions

import express from 'express';
import { optionalAuthenticate } from '../middleware/auth.js';
import { query, queryOne, generateUUID } from '../lib/mysql.js';
import { hasAdminAccess } from '../lib/auth.js';
import { getColumns, decodeRow, encodeValue, maxLength } from '../lib/schema.js';
import { policies, relations, PolicyError } from '../lib/dataPolicies.js';
import { adjustWallet } from '../lib/wallet.js';

const router = express.Router();

const MAX_ROWS = 1000;
const MAX_WRITE_ROWS = 200;

class RequestError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function buildContext(req) {
  const userId = req.userId || null;
  const isAdmin = userId ? await hasAdminAccess(userId, req.tfaVerified === true) : false;
  return { userId, isAdmin };
}

function getPolicy(table) {
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(policies, table)) {
    throw new RequestError('Unknown table', 404, 'UNKNOWN_TABLE');
  }
  return policies[table];
}

async function requireColumns(table) {
  const columns = await getColumns(table);
  if (!columns) {
    throw new RequestError(
      `Table "${table}" does not exist in the database. Run the latest migrations.`,
      500,
      'MISSING_TABLE'
    );
  }
  return columns;
}

function assertColumn(columns, name) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(columns, name)) {
    throw new RequestError(`Unknown column "${name}"`, 400, 'UNKNOWN_COLUMN');
  }
  return name;
}

const OPERATORS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'LIKE',
};

const MAX_IN_LIST = 200;

// filters: [{ col, op, val }]
// `allowed` (optional) limits which columns may be used: a caller must not be
// able to probe a column they are not allowed to read.
function buildFilters(filters, columns, allowed) {
  const clauses = [];
  const params = [];

  for (const filter of Array.isArray(filters) ? filters : []) {
    const col = assertColumn(columns, filter && filter.col);
    if (allowed && !allowed.includes(col)) {
      throw new RequestError(`Unknown column "${col}"`, 400, 'UNKNOWN_COLUMN');
    }
    const kind = columns[col];
    const op = filter.op;
    const val = filter.val;

    if (op === 'in' || op === 'not_in') {
      const list = Array.isArray(val) ? val : [];
      if (list.length > MAX_IN_LIST) throw new RequestError('Too many values in filter', 400, 'BAD_FILTER');
      if (list.some((item) => item === null || typeof item === 'object')) {
        throw new RequestError('Invalid filter value', 400, 'BAD_FILTER');
      }
      if (list.length === 0) {
        clauses.push(op === 'in' ? '1=0' : '1=1');
      } else {
        clauses.push(`\`${col}\` ${op === 'in' ? 'IN' : 'NOT IN'} (${list.map(() => '?').join(', ')})`);
        for (const item of list) params.push(encodeValue(item, kind));
      }
    } else if (op === 'is' || op === 'is_not') {
      const negate = op === 'is_not';
      if (val === null) {
        clauses.push(`\`${col}\` IS ${negate ? 'NOT ' : ''}NULL`);
      } else {
        clauses.push(`\`${col}\` ${negate ? '<>' : '='} ?`);
        params.push(val ? 1 : 0);
      }
    } else if (Object.prototype.hasOwnProperty.call(OPERATORS, op)) {
      if (val === null || val === undefined) {
        if (op === 'eq') clauses.push(`\`${col}\` IS NULL`);
        else if (op === 'neq') clauses.push(`\`${col}\` IS NOT NULL`);
        else clauses.push('1=0');
      } else {
        if (typeof val === 'object') throw new RequestError('Invalid filter value', 400, 'BAD_FILTER');
        const bound = encodeValue(val, kind);
        if (bound === null) {
          clauses.push('1=0');
        } else {
          clauses.push(`\`${col}\` ${OPERATORS[op]} ?`);
          params.push(bound);
        }
      }
    } else {
      throw new RequestError(`Unsupported filter "${op}"`, 400, 'BAD_FILTER');
    }
  }

  return { clauses, params };
}

// "*, cases(*), requester:court_participants!requested_by(*)"
function parseSelect(spec, table, columns) {
  const text = typeof spec === 'string' && spec.trim() ? spec : '*';
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  let all = false;
  const cols = [];
  const embeds = [];

  for (const part of parts) {
    if (part === '*') {
      all = true;
      continue;
    }
    const embed = part.match(/^(?:([A-Za-z_][A-Za-z0-9_]*):)?([A-Za-z_][A-Za-z0-9_]*)(?:!([A-Za-z_][A-Za-z0-9_]*))?\((.*)\)$/);
    if (embed) {
      const [, alias, target, hint] = embed;
      // Only relations declared in dataPolicies.js can be embedded; the hint
      // may name that relation's own foreign key and nothing else.
      const fk = Object.prototype.hasOwnProperty.call(relations, table)
        && Object.prototype.hasOwnProperty.call(relations[table], target)
        ? relations[table][target]
        : null;
      if (!fk || (hint && hint !== fk) || !Object.prototype.hasOwnProperty.call(policies, target)) {
        throw new RequestError(`Cannot embed "${target}" in "${table}"`, 400, 'BAD_EMBED');
      }
      embeds.push({ alias: alias || target, target, fk });
      continue;
    }
    cols.push(assertColumn(columns, part));
  }

  return { all: all || cols.length === 0, cols, embeds };
}

// Columns a caller is allowed to see for a table.
function visibleColumns(table, columns, ctx) {
  const policy = policies[table];
  let names = Object.keys(columns);
  if (!ctx.isAdmin) {
    if (Array.isArray(policy.visible)) names = names.filter((n) => policy.visible.includes(n));
    if (Array.isArray(policy.hidden)) names = names.filter((n) => !policy.hidden.includes(n));
  }
  return names;
}

function finishRow(table, row, columns, ctx) {
  const policy = policies[table];
  const decoded = decodeRow(row, columns);
  return typeof policy.decode === 'function' ? policy.decode(decoded, ctx) : decoded;
}

// WHERE for a read: request filters AND the table's read policy.
async function readScope(table, policy, columns, filters, ctx) {
  if (!ctx.userId && !policy.publicRead) {
    throw new RequestError('Please sign in.', 401, 'UNAUTHENTICATED');
  }
  if (!ctx.isAdmin && typeof policy.read !== 'function') {
    throw new RequestError('You do not have permission to read this.', 403, 'FORBIDDEN');
  }
  const built = buildFilters(filters, columns, ctx.isAdmin ? null : visibleColumns(table, columns, ctx));
  const clauses = [...built.clauses];
  const params = [...built.params];

  if (!ctx.isAdmin) {
    if (Array.isArray(policy.requireFilter)) {
      // The caller must name what they want with a real value (an id or code),
      // not merely mention the column.
      const isName = (v) => typeof v === 'string' && v.trim().length >= 4;
      const named = (Array.isArray(filters) ? filters : []).some((f) => {
        if (!f || !policy.requireFilter.includes(f.col)) return false;
        if (f.op === 'eq') return isName(f.val);
        if (f.op === 'in') return Array.isArray(f.val) && f.val.length > 0 && f.val.every(isName);
        return false;
      });
      if (!named) {
        throw new RequestError('This query is too broad.', 403, 'FORBIDDEN');
      }
    }
    const fragment = policy.read(ctx, Array.isArray(filters) ? filters : []);
    clauses.push(`(${fragment.sql})`);
    params.push(...fragment.params);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function attachEmbeds(rows, embeds, ctx) {
  for (const embed of embeds) {
    const targetColumns = await requireColumns(embed.target);
    const ids = [...new Set(rows.map((row) => row[embed.fk]).filter((v) => v !== null && v !== undefined))];
    const byId = new Map();
    if (ids.length > 0) {
      const names = visibleColumns(embed.target, targetColumns, ctx);
      if (!names.includes('id')) names.push('id');
      // The embedded table's own read rule still applies.
      let scope = '';
      const scopeParams = [];
      if (!ctx.isAdmin) {
        const targetPolicy = policies[embed.target];
        if (typeof targetPolicy.read !== 'function' || (!ctx.userId && !targetPolicy.publicRead)) {
          for (const row of rows) row[embed.alias] = null;
          continue;
        }
        const fragment = targetPolicy.read(ctx, [{ col: 'id', op: 'eq', val: ids[0] }]);
        scope = ` AND (${fragment.sql})`;
        scopeParams.push(...fragment.params);
      }
      const found = await query(
        `SELECT ${names.map((n) => `\`${n}\``).join(', ')} FROM \`${embed.target}\`
         WHERE id IN (${ids.map(() => '?').join(', ')})${scope}`,
        [...ids, ...scopeParams]
      );
      for (const item of found) byId.set(item.id, finishRow(embed.target, item, targetColumns, ctx));
    }
    for (const row of rows) {
      row[embed.alias] = byId.get(row[embed.fk]) || null;
    }
  }
}

async function runSelect(body, ctx) {
  const table = body.table;
  const policy = getPolicy(table);
  const columns = await requireColumns(table);
  const { where, params } = await readScope(table, policy, columns, body.filters, ctx);
  const select = parseSelect(body.select, table, columns);

  let count = null;
  if (body.count) {
    const counted = await queryOne(`SELECT COUNT(*) AS total FROM \`${table}\` ${where}`, params);
    count = Number(counted.total) || 0;
  }
  if (body.head) return { data: null, count };

  const allowed = visibleColumns(table, columns, ctx);
  let names = select.all ? allowed : select.cols.filter((c) => allowed.includes(c));
  // Embedded rows are joined on their foreign key, so it must be fetched.
  const extra = select.embeds.map((e) => e.fk).filter((fk) => !names.includes(fk));
  const fetchNames = [...names, ...extra];
  if (fetchNames.length === 0) {
    throw new RequestError('No readable columns requested.', 403, 'FORBIDDEN');
  }

  let sql = `SELECT ${fetchNames.map((n) => `\`${n}\``).join(', ')} FROM \`${table}\` ${where}`;

  const orders = [];
  for (const order of Array.isArray(body.order) ? body.order : []) {
    const col = assertColumn(columns, order && order.col);
    if (!allowed.includes(col)) throw new RequestError(`Unknown column "${col}"`, 400, 'UNKNOWN_COLUMN');
    orders.push(`\`${col}\` ${order.asc === false ? 'DESC' : 'ASC'}`);
  }
  if (orders.length) sql += ` ORDER BY ${orders.join(', ')}`;

  let limit = Number.parseInt(body.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_ROWS) limit = MAX_ROWS;
  if (body.single) limit = Math.min(limit, 2);
  let offset = Number.parseInt(body.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  sql += ` LIMIT ${limit} OFFSET ${offset}`;

  const raw = await query(sql, params);
  const rows = raw.map((row) => finishRow(table, row, columns, ctx));
  await attachEmbeds(rows, select.embeds, ctx);
  for (const row of rows) {
    for (const name of extra) delete row[name];
  }

  return { data: shapeSingle(rows, body.single), count };
}

function shapeSingle(rows, single) {
  if (!single) return rows;
  if (rows.length === 1) return rows[0];
  if (rows.length === 0 && single === 'maybe') return null;
  // Same code PostgREST uses, which parts of the frontend check for.
  throw new RequestError(
    rows.length === 0 ? 'No rows found' : 'More than one row found',
    406,
    'PGRST116'
  );
}

// Keeps only real columns and converts values for binding.
function encodeRow(table, row, columns) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!Object.prototype.hasOwnProperty.call(columns, key)) {
      console.warn(`[Data API] Ignoring unknown column ${table}.${key}`);
      continue;
    }
    if (value === undefined) continue;
    let encoded = encodeValue(value, columns[key]);
    // The app was written for a database without length limits. Trim text to
    // the column size instead of failing the whole write.
    const limit = maxLength(table, key);
    if (limit && typeof encoded === 'string' && encoded.length > limit) {
      console.warn(`[Data API] ${table}.${key} trimmed from ${encoded.length} to ${limit} characters`);
      encoded = encoded.slice(0, limit);
    }
    out[key] = encoded;
  }
  return out;
}

async function fetchByIds(table, ids, columns, ctx, selectSpec, single) {
  if (ids.length === 0) return shapeSingle([], single);
  const select = parseSelect(selectSpec, table, columns);
  const allowed = visibleColumns(table, columns, ctx);
  const names = select.all ? allowed : select.cols.filter((c) => allowed.includes(c));
  const extra = select.embeds.map((e) => e.fk).filter((fk) => !names.includes(fk));
  const fetchNames = [...names, ...extra];
  if (!fetchNames.includes('id')) fetchNames.push('id');
  const found = await query(
    `SELECT ${fetchNames.map((n) => `\`${n}\``).join(', ')} FROM \`${table}\`
     WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  const byId = new Map(found.map((row) => [row.id, finishRow(table, row, columns, ctx)]));
  const rows = ids.map((id) => byId.get(id)).filter(Boolean);
  await attachEmbeds(rows, select.embeds, ctx);
  for (const row of rows) {
    for (const name of extra) delete row[name];
    if (!select.all && !select.cols.includes('id')) delete row.id;
  }
  return shapeSingle(rows, single);
}

async function runInsert(body, ctx) {
  const table = body.table;
  const policy = getPolicy(table);
  const columns = await requireColumns(table);
  if (!ctx.userId) throw new RequestError('Please sign in.', 401, 'UNAUTHENTICATED');

  const input = Array.isArray(body.values) ? body.values : [body.values];
  if (input.length === 0 || input.some((row) => !row || typeof row !== 'object')) {
    throw new RequestError('Nothing to insert.', 400);
  }
  if (input.length > MAX_WRITE_ROWS) throw new RequestError('Too many rows in one request.', 400);

  const prepared = [];
  for (const original of input) {
    let row = { ...original };
    if (ctx.isAdmin) {
      if (policy.adminWrite === false) {
        throw new RequestError('This table can only be changed by the server.', 403, 'FORBIDDEN');
      }
      if (typeof policy.adminTransform === 'function') row = policy.adminTransform(row, ctx);
    } else {
      if (typeof policy.insert !== 'function') {
        throw new RequestError('You do not have permission to add this.', 403, 'FORBIDDEN');
      }
      row = await policy.insert(row, ctx);
    }
    const encoded = encodeRow(table, row, columns);
    if (Object.prototype.hasOwnProperty.call(columns, 'id') && !encoded.id) {
      encoded.id = generateUUID();
    }
    prepared.push(encoded);
  }

  const ids = [];
  for (const row of prepared) {
    const keys = Object.keys(row);
    await query(
      `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')})
       VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => row[k])
    );
    ids.push(row.id);
  }

  if (typeof policy.afterInsert === 'function') {
    try {
      await policy.afterInsert(prepared, ctx);
    } catch (error) {
      console.error(`[Data API] afterInsert(${table}) failed:`, error.message);
    }
  }

  if (!body.returning) return { data: null, count: null };
  return { data: await fetchByIds(table, ids, columns, ctx, body.select, body.single), count: null };
}

// Ids of the rows a write is allowed to touch: request filters AND policy.
async function writableIds(table, policy, columns, body, ctx, kind) {
  if (!ctx.userId) throw new RequestError('Please sign in.', 401, 'UNAUTHENTICATED');
  if (!Array.isArray(body.filters) || body.filters.length === 0) {
    throw new RequestError(`${kind} needs at least one filter.`, 400);
  }
  const built = buildFilters(body.filters, columns, ctx.isAdmin ? null : visibleColumns(table, columns, ctx));
  const clauses = [...built.clauses];
  const params = [...built.params];

  if (ctx.isAdmin) {
    if (policy.adminWrite === false) {
      throw new RequestError('This table can only be changed by the server.', 403, 'FORBIDDEN');
    }
  } else {
    const rule = policy[kind];
    if (typeof rule !== 'function') {
      throw new RequestError('You do not have permission to change this.', 403, 'FORBIDDEN');
    }
    const fragment = rule(ctx);
    clauses.push(`(${fragment.sql})`);
    params.push(...fragment.params);
  }

  const rows = await query(
    `SELECT id FROM \`${table}\` WHERE ${clauses.join(' AND ')} LIMIT ${MAX_ROWS}`,
    params
  );
  return rows.map((row) => row.id);
}

async function runUpdate(body, ctx) {
  const table = body.table;
  const policy = getPolicy(table);
  const columns = await requireColumns(table);
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    throw new RequestError('Nothing to update.', 400);
  }

  const ids = await writableIds(table, policy, columns, body, ctx, 'update');

  let values = { ...body.values };
  if (ctx.isAdmin) {
    if (typeof policy.adminTransform === 'function') values = policy.adminTransform(values, ctx);
  } else if (Array.isArray(policy.updateOnly)) {
    for (const col of Object.keys(values)) {
      if (!policy.updateOnly.includes(col)) delete values[col];
    }
  } else {
    for (const col of policy.updateStrip || []) delete values[col];
  }
  delete values.id;
  const encoded = encodeRow(table, values, columns);
  const keys = Object.keys(encoded);

  if (ids.length > 0 && keys.length > 0) {
    await query(
      `UPDATE \`${table}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')}
       WHERE id IN (${ids.map(() => '?').join(', ')})`,
      [...keys.map((k) => encoded[k]), ...ids]
    );
    if (typeof policy.afterUpdate === 'function') {
      try {
        await policy.afterUpdate({ values: encoded, ids }, ctx);
      } catch (error) {
        console.error(`[Data API] afterUpdate(${table}) failed:`, error.message);
      }
    }
  }

  if (!body.returning) return { data: null, count: null };
  return { data: await fetchByIds(table, ids, columns, ctx, body.select, body.single), count: null };
}

async function runDelete(body, ctx) {
  const table = body.table;
  const policy = getPolicy(table);
  const columns = await requireColumns(table);
  const ids = await writableIds(table, policy, columns, body, ctx, 'delete');

  let removed = null;
  if (body.returning) {
    removed = await fetchByIds(table, ids, columns, ctx, body.select, body.single);
  }
  if (ids.length > 0) {
    await query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  }
  return { data: removed, count: null };
}

function sendError(res, error, label) {
  if (error instanceof RequestError || error instanceof PolicyError) {
    return res.status(error.status || 400).json({
      error: { message: error.message, code: error.code || 'FORBIDDEN' },
    });
  }
  console.error(`[Data API] ${label} failed:`, error);
  const duplicate = error && error.code === 'ER_DUP_ENTRY';
  return res.status(duplicate ? 409 : 500).json({
    error: {
      message: duplicate ? 'That already exists.' : 'The request could not be completed.',
      code: duplicate ? '23505' : 'SERVER_ERROR',
    },
  });
}

router.post('/query', optionalAuthenticate, async (req, res) => {
  const body = req.body || {};
  try {
    const ctx = await buildContext(req);
    let result;
    if (body.action === 'select') result = await runSelect(body, ctx);
    else if (body.action === 'insert') result = await runInsert(body, ctx);
    else if (body.action === 'update') result = await runUpdate(body, ctx);
    else if (body.action === 'delete') result = await runDelete(body, ctx);
    else throw new RequestError('Unknown action', 400);
    res.json({ data: result.data, count: result.count, error: null });
  } catch (error) {
    sendError(res, error, `${body.action} ${body.table}`);
  }
});

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

const rpcHandlers = {
  // Admin wallet adjustment (credit or debit) with a ledger entry.
  async update_wallet_balance(args, ctx) {
    if (!ctx.isAdmin) throw new RequestError('Admin access required', 403, 'FORBIDDEN');
    const target = await queryOne('SELECT id FROM users WHERE id = ?', [args.p_user_id]);
    if (!target) throw new RequestError('User not found', 404);
    const result = await adjustWallet({
      userId: args.p_user_id,
      amount: args.p_amount,
      type: args.p_transaction_type || 'admin_adjustment',
      description: args.p_description || null,
      referenceId: args.p_reference_id || null,
      referenceType: args.p_reference_type || null,
      createdBy: ctx.userId,
    });
    return result.balanceAfter;
  },

  async is_admin(args, ctx) {
    return ctx.isAdmin;
  },
};

router.post('/rpc', optionalAuthenticate, async (req, res) => {
  const { fn, args } = req.body || {};
  try {
    const ctx = await buildContext(req);
    if (!ctx.userId) throw new RequestError('Please sign in.', 401, 'UNAUTHENTICATED');
    if (typeof fn !== 'string' || !Object.prototype.hasOwnProperty.call(rpcHandlers, fn)) {
      throw new RequestError('Unknown function', 404);
    }
    const data = await rpcHandlers[fn](args || {}, ctx);
    res.json({ data, error: null });
  } catch (error) {
    if (error && (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'WALLET_ERROR')) {
      return res.status(400).json({ error: { message: error.message, code: error.code } });
    }
    sendError(res, error, `rpc ${fn}`);
  }
});

// ---------------------------------------------------------------------------
// Watch: lets the client notice changes without a websocket.
// The client polls with the tables it is subscribed to; for each one the
// server returns a fingerprint of the rows the caller can see, plus any rows
// created since the last poll.
// ---------------------------------------------------------------------------

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

router.post('/watch', optionalAuthenticate, async (req, res) => {
  try {
    const ctx = await buildContext(req);
    if (!ctx.userId) throw new RequestError('Please sign in.', 401, 'UNAUTHENTICATED');

    const subs = Array.isArray(req.body && req.body.subs) ? req.body.subs.slice(0, 20) : [];
    const clock = await queryOne("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now");
    const results = [];

    for (const sub of subs) {
      try {
        const table = sub.table;
        const policy = getPolicy(table);
        const columns = await requireColumns(table);
        const filters = sub.filter && sub.filter.col
          ? [{ col: sub.filter.col, op: 'eq', val: sub.filter.val }]
          : [];
        const { where, params } = await readScope(table, policy, columns, filters, ctx);

        const names = visibleColumns(table, columns, ctx);
        const fingerprint = await queryOne(
          `SELECT COUNT(*) AS c,
                  COALESCE(SUM(CRC32(CONCAT_WS('|', ${names.map((n) => `\`${n}\``).join(', ')}))), 0) AS s
           FROM \`${table}\` ${where}`,
          params
        );

        // Rows created since the caller's last poll. On the first poll this
        // is "the current second", which lets the client note what already
        // exists so it is not announced as new later.
        let inserted = [];
        if (Object.prototype.hasOwnProperty.call(columns, 'created_at')) {
          const since = typeof sub.since === 'string' && TIMESTAMP.test(sub.since) ? sub.since : clock.now;
          const allowed = visibleColumns(table, columns, ctx);
          const raw = await query(
            `SELECT ${allowed.map((n) => `\`${n}\``).join(', ')} FROM \`${table}\`
             ${where ? `${where} AND` : 'WHERE'} created_at >= ?
             ORDER BY created_at ASC LIMIT 50`,
            [...params, since]
          );
          inserted = raw.map((row) => finishRow(table, row, columns, ctx));
        }

        results.push({ sig: `${fingerprint.c}:${fingerprint.s}`, inserted });
      } catch (error) {
        results.push({ sig: null, inserted: [], error: error.message });
      }
    }

    res.json({ now: clock.now, results });
  } catch (error) {
    sendError(res, error, 'watch');
  }
});

export default router;
