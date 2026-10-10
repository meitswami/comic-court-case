// Access rules for the generic data API (server/routes/data.js).
//
// The frontend was written against Supabase, where row-level security decided
// who could read or change each row. These rules do the same job for MySQL:
// every read gets a WHERE fragment that limits it to rows the caller may see,
// and every write is checked (and its values cleaned) before it runs.
//
// A table that is not listed here cannot be reached through the data API at
// all. `users`, the authenticator tables and other server-only tables are
// deliberately absent.
//
// ctx = { userId: string | null, isAdmin: boolean }

import { query, queryOne, generateUUID } from './mysql.js';

export class PolicyError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

const deny = () => {
  throw new PolicyError('You do not have permission to do this.');
};

// ---------------------------------------------------------------------------
// WHERE fragments
// ---------------------------------------------------------------------------

const ALL = { sql: '1=1', params: [] };

const own = (col = 'user_id') => (ctx) => ({ sql: `\`${col}\` = ?`, params: [ctx.userId] });

const viaCase = (col = 'case_id') => (ctx) => ({
  sql: `\`${col}\` IN (SELECT id FROM cases WHERE user_id = ?)`,
  params: [ctx.userId],
});

// The caller joined the session, or owns the case the session belongs to.
const inSession = (col = 'session_id') => (ctx) => ({
  sql: `\`${col}\` IN (SELECT sid FROM (
           SELECT session_id AS sid FROM court_participants WHERE user_id = ?
           UNION
           SELECT cs.id AS sid FROM court_sessions cs JOIN cases c ON c.id = cs.case_id WHERE c.user_id = ?
         ) AS my_sessions)`,
  params: [ctx.userId, ctx.userId],
});

const viaHearingLog = (col = 'hearing_log_id') => (ctx) => ({
  sql: `\`${col}\` IN (SELECT id FROM hearing_logs WHERE user_id = ?)`,
  params: [ctx.userId],
});

// ---------------------------------------------------------------------------
// Row checks used on insert
// ---------------------------------------------------------------------------

async function ownsCase(caseId, ctx) {
  if (!caseId) return false;
  const row = await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [caseId, ctx.userId]);
  return !!row;
}

async function isInSession(sessionId, ctx) {
  if (!sessionId) return false;
  const row = await queryOne(
    `SELECT cs.id FROM court_sessions cs
     LEFT JOIN cases c ON c.id = cs.case_id
     WHERE cs.id = ?
       AND (c.user_id = ? OR EXISTS (
         SELECT 1 FROM court_participants cp WHERE cp.session_id = cs.id AND cp.user_id = ?
       ))`,
    [sessionId, ctx.userId, ctx.userId]
  );
  return !!row;
}

async function ownsHearingLog(logId, ctx) {
  if (!logId) return false;
  const row = await queryOne('SELECT id FROM hearing_logs WHERE id = ? AND user_id = ?', [logId, ctx.userId]);
  return !!row;
}

const forceOwner = (col = 'user_id') => async (row, ctx) => ({ ...row, [col]: ctx.userId });

const requireCase = (extra = {}) => async (row, ctx) => {
  if (!(await ownsCase(row.case_id, ctx))) deny();
  const out = { ...row };
  for (const [col, fn] of Object.entries(extra)) out[col] = fn(ctx);
  return out;
};

const requireSession = () => async (row, ctx) => {
  if (!(await isInSession(row.session_id, ctx))) {
    throw new PolicyError('Join the court session before doing this.');
  }
  return row;
};

const requireHearingLog = () => async (row, ctx) => {
  if (!(await ownsHearingLog(row.hearing_log_id, ctx))) deny();
  return row;
};

function strip(row, cols) {
  const out = { ...row };
  for (const col of cols) delete out[col];
  return out;
}

// Payment and lawyer-OTP columns of court_sessions are only ever set by the
// server (payment completion, OTP routes), never by a browser.
const SESSION_SERVER_COLUMNS = [
  'payment_status',
  'payment_id',
  'invoice_id',
  'payment_method',
  'actual_lawyer_otp',
  'actual_lawyer_otp_expires_at',
];

// Set only when a payment completes (server/lib/payments.js).
const SESSION_PAID_COLUMNS = [
  'lawyer_type',
  'court_hearing_fee',
  'ai_lawyer_fee',
  'actual_lawyer_fee',
  'total_fee',
  'actual_lawyer_id',
  'actual_lawyer_email',
  'actual_lawyer_consultation_requested',
  'actual_lawyer_callback_number',
  'hearing_started',
];

// Secrets of a payment gateway never leave the server once saved. Admins see
// a mask; saving the mask back unchanged keeps the stored value.
const GATEWAY_SECRET_COLUMNS = ['api_secret', 'salt_key'];
const MASK_PREFIX = '••••';

export function maskSecret(value) {
  if (value === null || value === undefined || value === '') return value;
  const text = String(value);
  return `${MASK_PREFIX}${MASK_PREFIX}${text.length > 8 ? text.slice(-4) : ''}`;
}

function dropMaskedSecrets(row) {
  const out = { ...row };
  for (const col of GATEWAY_SECRET_COLUMNS) {
    if (typeof out[col] === 'string' && out[col].startsWith(MASK_PREFIX)) delete out[col];
  }
  return out;
}

async function notifyAdmins(title, message, type, relatedCaseId) {
  const admins = await query("SELECT DISTINCT user_id FROM user_roles WHERE role = 'admin'");
  for (const admin of admins) {
    try {
      await query(
        `INSERT INTO notifications (id, user_id, title, message, type, related_case_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [generateUUID(), admin.user_id, title, message, type, relatedCaseId || null]
      );
    } catch (error) {
      console.error('[Notify admins] failed:', error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Policies
//
//   read                   : (ctx, filters) => fragment (non-admin callers)
//   update / delete        : (ctx) => fragment          (non-admin callers)
//   insert                 : async (row, ctx) => row     (non-admin callers)
//   updateStrip            : columns a non-admin may never change
//   updateOnly             : if set, the only columns a non-admin may change
//   hidden                 : columns removed from results for non-admins
//   visible                : if set, the only columns non-admins get back
//   requireFilter          : non-admin reads must filter (eq/in) on one of these
//   publicRead             : readable without signing in (still uses `read`)
//   adminWrite             : false => even admins cannot write (server-only)
//   adminTransform         : (row) => row, applied to admin writes
//   decode                 : (row, ctx) => row, applied to every returned row
//   afterInsert            : async (rows, ctx) => void
//   afterUpdate            : async (changes, ctx) => void
// ---------------------------------------------------------------------------

export const policies = {
  profiles: {
    read: own(),
    insert: forceOwner(),
    update: own(),
    updateStrip: ['id', 'user_id'],
  },

  user_roles: {
    read: own(),
    // Roles are granted at sign-up, or by an admin through /api/admin/users
    // (which protects the last admin). Never through the data API.
    adminWrite: false,
  },

  user_wallets: {
    read: own(),
    adminWrite: false, // balances only move through wallet transactions
  },

  transactions: {
    read: own(),
    adminWrite: false,
  },

  payments: {
    read: own(),
    hidden: ['gateway_signature'],
  },

  invoices: {
    read: own(),
  },

  // Admin only. Customers apply a code through /api/payments/promo/preview,
  // which never lists codes.
  promo_codes: {},

  promo_code_usage: {
    read: own(),
  },

  addons: {
    publicRead: true,
    read: () => ({ sql: "status = 'active'", params: [] }),
  },

  case_addons: {
    read: own(),
    // Created by the server when a payment completes.
  },

  // Admin only. The checkout learns which gateway is live from
  // GET /api/payments/gateway.
  payment_gateway_settings: {
    adminTransform: dropMaskedSecrets,
    decode: (row) => {
      const out = { ...row };
      for (const col of GATEWAY_SECRET_COLUMNS) {
        if (col in out) out[col] = maskSecret(out[col]);
      }
      return out;
    },
    // Only one gateway can be live at a time.
    afterUpdate: async ({ values, ids }) => {
      if (values.is_active === 1 || values.is_active === true) {
        if (ids.length === 1) {
          await query('UPDATE payment_gateway_settings SET is_active = 0 WHERE id <> ?', [ids[0]]);
        }
      }
    },
  },

  cases: {
    // Your own cases. A single case that has a court session can also be
    // looked up by its id: that is how someone invited with a court code sees
    // which case they are about to join. Listing never shows other people's.
    read: (ctx, filters) => {
      const byId = filters.some((f) => f && f.col === 'id' && f.op === 'eq');
      if (!byId) return { sql: 'user_id = ?', params: [ctx.userId] };
      return {
        sql: '(user_id = ? OR id IN (SELECT case_id FROM court_sessions))',
        params: [ctx.userId],
      };
    },
    insert: forceOwner(),
    update: own(),
    updateStrip: ['id', 'user_id'],
    delete: own(),
  },

  case_evidence: {
    read: viaCase(),
    insert: requireCase({ uploaded_by: (ctx) => ctx.userId }),
    update: viaCase(),
    updateStrip: ['id', 'case_id', 'uploaded_by'],
    delete: viaCase(),
  },

  case_reports: {
    read: viaCase(),
    insert: requireCase({ uploaded_by: (ctx) => ctx.userId }),
  },

  case_adjournments: {
    read: viaCase(),
    insert: requireCase(),
    update: viaCase(),
    updateStrip: ['id', 'case_id'],
  },

  case_intake_messages: {
    read: own(),
    insert: async (row, ctx) => {
      if (row.case_id && !(await ownsCase(row.case_id, ctx))) deny();
      return { ...row, user_id: ctx.userId };
    },
  },

  hearing_sessions: {
    read: viaCase(),
    insert: requireCase(),
    update: viaCase(),
    updateStrip: ['id', 'case_id'],
  },

  hearing_transcripts: {
    read: (ctx) => ({
      sql: `session_id IN (SELECT hs.id FROM hearing_sessions hs
                           JOIN cases c ON c.id = hs.case_id WHERE c.user_id = ?)`,
      params: [ctx.userId],
    }),
    insert: async (row, ctx) => {
      const session = await queryOne(
        `SELECT hs.id FROM hearing_sessions hs JOIN cases c ON c.id = hs.case_id
         WHERE hs.id = ? AND c.user_id = ?`,
        [row.session_id, ctx.userId]
      );
      if (!session) deny();
      return row;
    },
  },

  knowledge_base: {
    read: own(),
    insert: forceOwner(),
    update: own(),
    updateStrip: ['id', 'user_id'],
    delete: own(),
  },

  // A court session is joined with its id or 8-character court code. Anyone
  // signed in who has that can follow the hearing (participants, transcript,
  // requests); taking part - speaking, raising a hand, submitting evidence -
  // still requires joining. Nothing here can be listed without naming the
  // session.
  court_sessions: {
    read: () => ALL,
    requireFilter: ['id', 'court_code', 'case_id'],
    hidden: ['actual_lawyer_otp'],
    insert: async (row, ctx) => {
      if (!(await ownsCase(row.case_id, ctx))) {
        throw new PolicyError('You can only start a hearing for your own case.');
      }
      return {
        ...strip(row, [...SESSION_SERVER_COLUMNS, ...SESSION_PAID_COLUMNS]),
        created_by: ctx.userId,
      };
    },
    update: inSession('id'),
    // Running the hearing: nothing about payment, fees, lawyer or OTP.
    updateOnly: ['status', 'started_at', 'ended_at', 'next_hearing_date', 'adjournment_reason', 'video_recording_url'],
  },

  court_participants: {
    read: () => ALL,
    requireFilter: ['session_id', 'id'],
    insert: async (row, ctx) => {
      const session = await queryOne('SELECT id FROM court_sessions WHERE id = ?', [row.session_id]);
      if (!session) throw new PolicyError('Court session not found.', 404);
      const isAi = row.is_ai === true || row.is_ai === 1;
      return { ...row, user_id: isAi ? null : ctx.userId };
    },
    // Your own seat, or an AI seat in a session you are part of.
    update: (ctx) => {
      const session = inSession('session_id')(ctx);
      return {
        sql: `(user_id = ? OR (is_ai = 1 AND ${session.sql}))`,
        params: [ctx.userId, ...session.params],
      };
    },
    updateStrip: ['id', 'session_id', 'user_id'],
  },

  court_transcripts: {
    read: () => ALL,
    requireFilter: ['session_id'],
    insert: requireSession(),
  },

  court_hand_raises: {
    read: () => ALL,
    requireFilter: ['session_id'],
    insert: requireSession(),
    update: inSession(),
    updateStrip: ['id', 'session_id', 'participant_id'],
  },

  court_evidence_submissions: {
    read: () => ALL,
    requireFilter: ['session_id'],
    insert: requireSession(),
    update: inSession(),
    updateStrip: ['id', 'session_id', 'participant_id'],
  },

  court_date_requests: {
    read: () => ALL,
    requireFilter: ['session_id'],
    insert: requireSession(),
    update: inSession(),
    updateStrip: ['id', 'session_id', 'requested_by'],
  },

  court_witness_requests: {
    read: () => ALL,
    requireFilter: ['session_id'],
    insert: requireSession(),
    update: inSession(),
    updateStrip: ['id', 'session_id', 'requested_by'],
  },

  notifications: {
    read: own(),
    // A user can only create notifications for themselves; admins for anyone.
    insert: forceOwner(),
    update: own(),
    updateStrip: ['id', 'user_id', 'title', 'message', 'type'],
    delete: own(),
  },

  identity_verifications: {
    read: own(),
    insert: async (row, ctx) => {
      const exists = await queryOne('SELECT id FROM cases WHERE id = ?', [row.case_id]);
      if (!exists) throw new PolicyError('Case not found.', 404);
      return {
        ...strip(row, ['admin_notes', 'reviewed_by', 'reviewed_at']),
        user_id: ctx.userId,
        verification_status: 'pending',
      };
    },
    afterInsert: async (rows) => {
      for (const row of rows) {
        await notifyAdmins(
          'New Identity Verification Request',
          `${row.full_name} (${row.relation_to_case}) has requested verification for case access.`,
          'verification',
          row.case_id
        );
      }
    },
    adminTransform: (row, ctx) =>
      'verification_status' in row ? { ...row, reviewed_by: ctx.userId } : row,
  },

  ai_usage_logs: {
    read: own(),
  },

  hearing_logs: {
    read: own(),
    insert: async (row, ctx) => {
      if (!(await isInSession(row.session_id, ctx))) deny();
      return { ...row, user_id: ctx.userId };
    },
    update: own(),
    updateStrip: ['id', 'session_id', 'case_id', 'user_id'],
  },

  hearing_transcript_logs: { read: viaHearingLog(), insert: requireHearingLog() },
  hearing_evidence_logs: { read: viaHearingLog(), insert: requireHearingLog() },
  hearing_participant_logs: { read: viaHearingLog(), insert: requireHearingLog() },
  hearing_interaction_logs: { read: viaHearingLog(), insert: requireHearingLog() },
  hearing_document_processing_logs: { read: viaHearingLog(), insert: requireHearingLog() },
};

// Embedded selects such as `select('*, cases(*)')`: which column of the parent
// row points at the embedded table.
export const relations = {
  court_sessions: { cases: 'case_id' },
  court_hand_raises: { court_participants: 'participant_id' },
  court_evidence_submissions: { court_participants: 'participant_id' },
  court_date_requests: { court_participants: 'requested_by' },
  court_witness_requests: { court_participants: 'requested_by' },
  case_addons: { addons: 'addon_id' },
  hearing_logs: { cases: 'case_id', court_sessions: 'session_id' },
};
