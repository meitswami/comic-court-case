// Data access for the case-preparation workspace.
// Every read that starts from a client-supplied id joins through
// case_prep_workspaces and filters on owner_id, so one user can never reach
// another user's documents, facts, issues or briefs (tenant isolation).

import { pool, query, queryOne, generateUUID } from '../mysql.js';

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* ignore rollback failure; original error is more useful */
    }
    throw error;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const WORKSPACE_COLUMNS = `w.id, w.owner_id, w.case_id, w.title, w.matter_type, w.forum, w.client_side, w.description,
  w.analysis_status, w.analysis_error, w.analysis_started_at, w.last_analysed_at, w.created_at, w.updated_at`;

export async function createWorkspace(ownerId, data) {
  const id = generateUUID();
  await query(
    `INSERT INTO case_prep_workspaces (id, owner_id, case_id, title, matter_type, forum, client_side, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ownerId, data.case_id || null, data.title, data.matter_type || 'other', data.forum || null, data.client_side || null, data.description || null]
  );
  return getWorkspace(id, ownerId);
}

export async function listWorkspaces(ownerId) {
  return query(
    `SELECT ${WORKSPACE_COLUMNS},
       (SELECT COUNT(*) FROM case_prep_documents d WHERE d.workspace_id = w.id) AS document_count,
       (SELECT COUNT(*) FROM case_prep_facts f WHERE f.workspace_id = w.id AND f.review_status <> 'rejected') AS fact_count,
       (SELECT COUNT(*) FROM case_prep_facts f WHERE f.workspace_id = w.id AND f.review_status = 'pending') AS pending_review_count,
       (SELECT b.status FROM case_prep_briefs b WHERE b.workspace_id = w.id) AS brief_status
     FROM case_prep_workspaces w
     WHERE w.owner_id = ?
     ORDER BY w.updated_at DESC`,
    [ownerId]
  );
}

export async function getWorkspace(id, ownerId) {
  if (!id || !ownerId) return null;
  return queryOne(`SELECT ${WORKSPACE_COLUMNS} FROM case_prep_workspaces w WHERE w.id = ? AND w.owner_id = ?`, [id, ownerId]);
}

export async function updateWorkspace(id, ownerId, fields) {
  const allowed = ['title', 'matter_type', 'forum', 'client_side', 'description', 'case_id'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getWorkspace(id, ownerId);
  await query(
    `UPDATE case_prep_workspaces SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND owner_id = ?`,
    [...keys.map((k) => fields[k] ?? null), id, ownerId]
  );
  return getWorkspace(id, ownerId);
}

export async function touchWorkspace(id) {
  await query('UPDATE case_prep_workspaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

export async function setAnalysisState(id, state, error = null) {
  if (state === 'running') {
    await query(
      `UPDATE case_prep_workspaces SET analysis_status = 'running', analysis_error = NULL, analysis_started_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  } else if (state === 'idle') {
    await query(
      `UPDATE case_prep_workspaces SET analysis_status = 'idle', analysis_error = NULL, last_analysed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  } else {
    await query(`UPDATE case_prep_workspaces SET analysis_status = 'failed', analysis_error = ? WHERE id = ?`, [String(error || 'Analysis failed').slice(0, 500), id]);
  }
}

/** Reset work interrupted by a server restart. */
export async function recoverInterruptedAnalyses() {
  await query(
    `UPDATE case_prep_documents SET status = 'failed', error_message = 'Analysis was interrupted by a server restart. Run analysis again.' WHERE status = 'analysing'`
  );
  await query(
    `UPDATE case_prep_workspaces SET analysis_status = 'failed', analysis_error = 'Analysis was interrupted by a server restart. Run analysis again.' WHERE analysis_status = 'running'`
  );
}

export async function deleteWorkspace(id, ownerId) {
  const docs = await query(
    `SELECT d.storage_key FROM case_prep_documents d JOIN case_prep_workspaces w ON w.id = d.workspace_id WHERE w.id = ? AND w.owner_id = ?`,
    [id, ownerId]
  );
  const result = await query('DELETE FROM case_prep_workspaces WHERE id = ? AND owner_id = ?', [id, ownerId]);
  return { deleted: result.affectedRows > 0, storageKeys: docs.map((d) => d.storage_key) };
}

// ---------------------------------------------------------------------------
// Documents and passages
// ---------------------------------------------------------------------------

const DOCUMENT_COLUMNS = `d.id, d.workspace_id, d.original_name, d.mime_type, d.size_bytes, d.sha256, d.encrypted,
  d.doc_type, d.document_language, d.page_count, d.char_count, d.extraction_method, d.status, d.error_message,
  d.statute_mentions, d.analysed_at, d.created_at`;

function mapDocument(row) {
  if (!row) return row;
  return { ...row, encrypted: Boolean(row.encrypted), statute_mentions: parseJson(row.statute_mentions, []) };
}

export async function findDocumentByHash(workspaceId, sha256) {
  return queryOne('SELECT id, original_name FROM case_prep_documents WHERE workspace_id = ? AND sha256 = ?', [workspaceId, sha256]);
}

export async function insertDocument(doc, passages) {
  return withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO case_prep_documents
        (id, workspace_id, original_name, mime_type, size_bytes, sha256, storage_key, encrypted, page_count, char_count,
         extraction_method, status, error_message, statute_mentions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, doc.workspace_id, doc.original_name, doc.mime_type, doc.size_bytes, doc.sha256, doc.storage_key, doc.encrypted ? 1 : 0,
        doc.page_count, doc.char_count, doc.extraction_method, doc.status, doc.error_message || null, json(doc.statute_mentions || [])]
    );
    await insertPassages(conn, doc.id, doc.workspace_id, passages);
  });
}

export async function insertPassages(conn, documentId, workspaceId, passages) {
  for (const p of passages) {
    await conn.execute(
      `INSERT INTO case_prep_passages (id, document_id, workspace_id, label, page_number, passage_index, content, char_start, char_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateUUID(), documentId, workspaceId, p.label, p.page_number, p.passage_index, p.content, p.char_start, p.char_end]
    );
  }
}

export async function listDocuments(workspaceId) {
  const rows = await query(`SELECT ${DOCUMENT_COLUMNS} FROM case_prep_documents d WHERE d.workspace_id = ? ORDER BY d.created_at ASC, d.id ASC`, [workspaceId]);
  return rows.map(mapDocument);
}

/** Owner-scoped document lookup (includes storage key for file reads). */
export async function getDocumentForOwner(documentId, ownerId) {
  const row = await queryOne(
    `SELECT ${DOCUMENT_COLUMNS}, d.storage_key FROM case_prep_documents d
     JOIN case_prep_workspaces w ON w.id = d.workspace_id
     WHERE d.id = ? AND w.owner_id = ?`,
    [documentId, ownerId]
  );
  return mapDocument(row);
}

export async function getDocumentInternal(documentId) {
  return mapDocument(await queryOne(`SELECT ${DOCUMENT_COLUMNS}, d.storage_key FROM case_prep_documents d WHERE d.id = ?`, [documentId]));
}

export async function updateDocument(documentId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const values = keys.map((k) => (k === 'statute_mentions' ? json(fields[k]) : fields[k]));
  await query(`UPDATE case_prep_documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...values, documentId]);
}

export async function deleteDocument(documentId) {
  await query('DELETE FROM case_prep_documents WHERE id = ?', [documentId]);
}

export async function getPassages(documentId) {
  return query(
    `SELECT id, document_id, label, page_number, passage_index, content, char_start, char_end
     FROM case_prep_passages WHERE document_id = ? ORDER BY page_number, passage_index`,
    [documentId]
  );
}

export async function replacePassages(documentId, workspaceId, passages) {
  await withTransaction(async (conn) => {
    await conn.execute('DELETE FROM case_prep_passages WHERE document_id = ?', [documentId]);
    await insertPassages(conn, documentId, workspaceId, passages);
  });
}

// ---------------------------------------------------------------------------
// Facts and citations
// ---------------------------------------------------------------------------

const FACT_COLUMNS = `f.id, f.workspace_id, f.document_id, f.statement, f.original_statement, f.fact_type,
  DATE_FORMAT(f.event_date, '%Y-%m-%d') AS event_date, f.date_text, f.date_precision, f.date_flag, f.parties,
  f.verification, f.unverified_reason, f.claimed_sources, f.review_status, f.origin, f.reviewer_note,
  f.reviewed_by, f.reviewed_at, f.created_at, f.updated_at`;

function mapFact(row) {
  return { ...row, parties: parseJson(row.parties, []), claimed_sources: parseJson(row.claimed_sources, []) };
}

export async function listFacts(workspaceId) {
  const facts = (await query(
    `SELECT ${FACT_COLUMNS} FROM case_prep_facts f WHERE f.workspace_id = ?
     ORDER BY (f.event_date IS NULL), f.event_date, f.created_at, f.id`,
    [workspaceId]
  )).map(mapFact);
  const citations = await query(
    `SELECT c.id, c.fact_id, c.document_id, c.passage_id, c.page_number, c.quote, c.quote_start, c.quote_end, c.match_type,
       p.label AS passage_label, d.original_name AS document_name
     FROM case_prep_citations c
     JOIN case_prep_passages p ON p.id = c.passage_id
     JOIN case_prep_documents d ON d.id = c.document_id
     WHERE c.workspace_id = ? ORDER BY c.page_number, p.passage_index`,
    [workspaceId]
  );
  const byFact = new Map();
  for (const c of citations) {
    if (!byFact.has(c.fact_id)) byFact.set(c.fact_id, []);
    byFact.get(c.fact_id).push(c);
  }
  return facts.map((f) => ({ ...f, citations: byFact.get(f.id) || [] }));
}

export async function getFactForOwner(factId, ownerId) {
  const row = await queryOne(
    `SELECT ${FACT_COLUMNS} FROM case_prep_facts f JOIN case_prep_workspaces w ON w.id = f.workspace_id
     WHERE f.id = ? AND w.owner_id = ?`,
    [factId, ownerId]
  );
  return row ? mapFact(row) : null;
}

export async function insertFact(conn, fact, citations) {
  const id = generateUUID();
  await conn.execute(
    `INSERT INTO case_prep_facts
      (id, workspace_id, document_id, statement, original_statement, fact_type, event_date, date_text, date_precision, date_flag,
       parties, verification, unverified_reason, claimed_sources, review_status, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, fact.workspace_id, fact.document_id || null, fact.statement, fact.original_statement || null, fact.fact_type || 'other',
      fact.event_date || null, fact.date_text || null, fact.date_precision || 'unknown', fact.date_flag || null,
      json(fact.parties || []), fact.verification, fact.unverified_reason || null, json(fact.claimed_sources || null),
      fact.review_status || 'pending', fact.origin || 'ai']
  );
  for (const c of citations) {
    await conn.execute(
      `INSERT INTO case_prep_citations (id, workspace_id, fact_id, document_id, passage_id, page_number, quote, quote_start, quote_end, match_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateUUID(), fact.workspace_id, id, c.document_id, c.passage_id, c.page_number, c.quote, c.quote_start, c.quote_end, c.match_type]
    );
  }
  return id;
}

/** Re-analysis replaces only AI facts nobody has reviewed yet. */
export async function deletePendingAiFactsForDocument(conn, documentId) {
  await conn.execute(`DELETE FROM case_prep_facts WHERE document_id = ? AND origin = 'ai' AND review_status = 'pending'`, [documentId]);
}

export async function existingFactStatements(documentId) {
  const rows = await query('SELECT statement, original_statement FROM case_prep_facts WHERE document_id = ?', [documentId]);
  return rows.flatMap((r) => [r.statement, r.original_statement].filter(Boolean));
}

export async function updateFact(factId, fields, reviewerId) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const values = keys.map((k) => (k === 'parties' ? json(fields[k]) : fields[k]));
  await query(
    `UPDATE case_prep_facts SET ${keys.map((k) => `${k} = ?`).join(', ')}, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...values, reviewerId, factId]
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

function mapIssue(row) {
  return {
    ...row,
    fact_ids: parseJson(row.fact_ids, []),
    provisions: parseJson(row.provisions, []),
    evidence_gaps: parseJson(row.evidence_gaps, []),
    counter_arguments: parseJson(row.counter_arguments, []),
    sanitation_notes: parseJson(row.sanitation_notes, []),
  };
}

export async function listIssues(workspaceId) {
  return (await query('SELECT * FROM case_prep_issues WHERE workspace_id = ? ORDER BY created_at ASC, id ASC', [workspaceId])).map(mapIssue);
}

export async function getIssueForOwner(issueId, ownerId) {
  const row = await queryOne(
    `SELECT i.* FROM case_prep_issues i JOIN case_prep_workspaces w ON w.id = i.workspace_id WHERE i.id = ? AND w.owner_id = ?`,
    [issueId, ownerId]
  );
  return row ? mapIssue(row) : null;
}

export async function replacePendingAiIssues(workspaceId, issues) {
  await withTransaction(async (conn) => {
    await conn.execute(`DELETE FROM case_prep_issues WHERE workspace_id = ? AND origin = 'ai' AND review_status = 'pending'`, [workspaceId]);
    for (const issue of issues) {
      await conn.execute(
        `INSERT INTO case_prep_issues (id, workspace_id, title, analysis, issue_type, fact_ids, provisions, evidence_gaps, counter_arguments, sanitation_notes, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai')`,
        [generateUUID(), workspaceId, issue.title, issue.analysis, issue.issue_type, json(issue.fact_ids), json(issue.provisions),
          json(issue.evidence_gaps), json(issue.counter_arguments), json(issue.sanitation_notes)]
      );
    }
  });
}

export async function updateIssue(issueId, fields, reviewerId) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await query(
    `UPDATE case_prep_issues SET ${keys.map((k) => `${k} = ?`).join(', ')}, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...keys.map((k) => fields[k]), reviewerId, issueId]
  );
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

function mapBrief(row) {
  return row ? { ...row, content: parseJson(row.content, { sections: [] }) } : null;
}

export async function getBrief(workspaceId) {
  return mapBrief(await queryOne('SELECT * FROM case_prep_briefs WHERE workspace_id = ?', [workspaceId]));
}

/**
 * Write a new brief revision. Fails (returns null) if `expectedRevision`
 * no longer matches, so concurrent edits are not silently overwritten.
 * Any edit drops an approval back to draft.
 */
export async function saveBrief(workspaceId, content, editorId, expectedRevision) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM case_prep_briefs WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
    const existing = rows[0];
    let briefId;
    let revision;
    if (!existing) {
      briefId = generateUUID();
      revision = 1;
      await conn.execute('INSERT INTO case_prep_briefs (id, workspace_id, revision, content, status) VALUES (?, ?, 1, ?, \'draft\')', [briefId, workspaceId, json(content)]);
    } else {
      if (expectedRevision !== undefined && expectedRevision !== null && Number(existing.revision) !== Number(expectedRevision)) return null;
      briefId = existing.id;
      revision = Number(existing.revision) + 1;
      await conn.execute(
        `UPDATE case_prep_briefs SET content = ?, revision = ?, status = 'draft', approved_by = NULL, approved_at = NULL, approval_attestation = NULL WHERE id = ?`,
        [json(content), revision, briefId]
      );
    }
    await conn.execute('INSERT INTO case_prep_brief_revisions (id, brief_id, revision, content, edited_by) VALUES (?, ?, ?, ?, ?)', [generateUUID(), briefId, revision, json(content), editorId]);
    return revision;
  }).then(async (revision) => (revision === null ? null : getBrief(workspaceId)));
}

export async function approveBrief(workspaceId, revision, approverId, attestation) {
  const result = await query(
    `UPDATE case_prep_briefs SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, approval_attestation = ?
     WHERE workspace_id = ? AND revision = ?`,
    [approverId, attestation, workspaceId, revision]
  );
  return result.affectedRows > 0;
}

/** Reviewed data changed underneath an approved brief: approval no longer holds. */
export async function invalidateBriefApproval(workspaceId) {
  const result = await query(
    `UPDATE case_prep_briefs SET status = 'draft', approved_by = NULL, approved_at = NULL, approval_attestation = NULL
     WHERE workspace_id = ? AND status = 'approved'`,
    [workspaceId]
  );
  return result.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function logAudit(workspaceId, actorId, action, entityType = null, entityId = null, details = null) {
  try {
    await query(
      'INSERT INTO case_prep_audit_log (id, workspace_id, actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [generateUUID(), workspaceId, actorId || null, action, entityType, entityId, json(details)]
    );
  } catch (error) {
    console.warn('[case-prep] audit log failed:', error.message);
  }
}

export async function listAudit(workspaceId) {
  const rows = await query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.email AS actor_email
     FROM case_prep_audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.workspace_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
    [workspaceId]
  );
  return rows.map((r) => ({ ...r, details: parseJson(r.details, null) }));
}
