// Case Preparation Workspace routes (/api/case-prep)
//
// Upload legal documents -> page-anchored source text -> AI-extracted facts
// verified against that text -> chronology and issues -> editable brief that
// a human must approve. Every route requires a session and is scoped to the
// workspace owner; other users get 404 (existence is not revealed).

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { generateUUID, queryOne } from '../lib/mysql.js';
import { describeAIProvider, resolveAIConfig } from '../lib/ai-provider.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import * as repo from '../lib/case-prep/repo.js';
import { ExtractionError, MAX_FILE_BYTES, extractDocument, sniffFile } from '../lib/case-prep/extract.js';
import { StorageConfigError, deleteFile, readFile, saveFile, storageStatus } from '../lib/case-prep/storage.js';
import { codeTransitionAlerts, findStatuteMentions, INDIA_CODE_URL, summariseMentions } from '../lib/case-prep/legal-rules.js';
import { stripControlChars, verifyCitation } from '../lib/case-prep/text.js';
import { FACT_TYPES } from '../lib/case-prep/analysis.js';
import { BriefValidationError, applyBriefEdits, approvalBlockers, briefHasReviewerEdits, buildBrief } from '../lib/case-prep/brief.js';
import { isRunning, startAnalysis } from '../lib/case-prep/jobs.js';

const router = express.Router();
const MAX_FILES_PER_UPLOAD = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD, fields: 10 },
});

export const analyseLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: 'Analysis can be started at most 6 times every 10 minutes. Please wait and try again.',
});
export const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many uploads in a short time. Please wait and try again.',
});

// Confidential data: never cache, always authenticate.
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
router.use(authenticate);

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(res, what = 'Workspace') {
  return res.status(404).json({ error: `${what} not found`, code: 'NOT_FOUND' });
}

function validate(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const err = new Error(`${issue.path.join('.') || 'body'}: ${issue.message}`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  return result.data;
}

async function loadWorkspace(req, res) {
  const id = req.params.id;
  if (!UUID_RE.test(id || '')) {
    notFound(res);
    return null;
  }
  const workspace = await repo.getWorkspace(id, req.userId);
  if (!workspace) notFound(res);
  return workspace;
}

function decodeFilename(name) {
  // Multer decodes multipart filenames as latin1; recover UTF-8 (Hindi names).
  let decoded = name;
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('�')) decoded = utf8;
  } catch {
    /* keep original */
  }
  const base = stripControlChars(path.basename(decoded), '').trim();
  return (base || 'document').slice(0, 255);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

router.get('/status', (req, res) => {
  const storage = storageStatus();
  res.json({
    ai: describeAIProvider(),
    storage: { ready: storage.ready, encrypted: storage.encrypted, error: storage.ready ? null : storage.error },
    limits: { maxFileMb: MAX_FILE_BYTES / (1024 * 1024), maxFilesPerUpload: MAX_FILES_PER_UPLOAD, acceptedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'] },
    authority: { statuteRetrieval: false, caseLawRetrieval: false, verifyAt: INDIA_CODE_URL },
  });
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

const MATTER_TYPES = ['criminal', 'civil', 'family', 'consumer', 'corporate', 'constitutional', 'other'];
const optionalText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const workspaceSchema = z.object({
  title: z.string().trim().min(3, 'must be at least 3 characters').max(255),
  matter_type: z.enum(MATTER_TYPES).default('other'),
  forum: optionalText(255),
  client_side: optionalText(120),
  description: optionalText(4000),
  case_id: z.string().regex(UUID_RE, 'must be a case id').optional().nullable(),
});

router.get('/workspaces', asyncRoute(async (req, res) => {
  const rows = await repo.listWorkspaces(req.userId);
  res.json(rows.map((r) => ({
    ...r,
    document_count: Number(r.document_count),
    fact_count: Number(r.fact_count),
    pending_review_count: Number(r.pending_review_count),
  })));
}));

router.post('/workspaces', asyncRoute(async (req, res) => {
  const data = validate(workspaceSchema, req.body);
  if (data.case_id) {
    const owned = await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [data.case_id, req.userId]);
    if (!owned) return res.status(400).json({ error: 'case_id: case not found', code: 'VALIDATION_ERROR' });
  }
  const workspace = await repo.createWorkspace(req.userId, data);
  await repo.logAudit(workspace.id, req.userId, 'workspace_created', 'workspace', workspace.id, { title: workspace.title });
  res.status(201).json(workspace);
}));

async function workspacePayload(workspace) {
  const [documents, facts, issues, brief] = await Promise.all([
    repo.listDocuments(workspace.id),
    repo.listFacts(workspace.id),
    repo.listIssues(workspace.id),
    repo.getBrief(workspace.id),
  ]);
  const mentions = documents.flatMap((d) => (d.statute_mentions || []).map((m) => ({ ...m, document_id: d.id, document_name: d.original_name })));
  const alerts = codeTransitionAlerts(mentions, facts).map((a) => ({ ...a, source: 'rule' }));

  const scanned = documents.filter((d) => d.status === 'needs_ocr' && !d.mime_type.startsWith('image/'));
  if (scanned.length) {
    alerts.push({
      code: 'SCANNED_PDF', severity: 'medium', source: 'system',
      title: `${scanned.length} scanned PDF${scanned.length > 1 ? 's' : ''} cannot be read yet`,
      message: 'These PDFs have no text layer. Upload clear photos of the pages (PNG/JPEG) or a searchable PDF so their contents can be cited.',
    });
  }
  const images = documents.filter((d) => d.status === 'needs_ocr' && d.mime_type.startsWith('image/'));
  if (images.length && !describeAIProvider().vision) {
    alerts.push({
      code: 'OCR_UNAVAILABLE', severity: 'medium', source: 'system',
      title: 'Images need a vision-capable AI model',
      message: 'The configured AI model does not read images, so uploaded photos cannot be transcribed. Upload searchable PDFs instead.',
    });
  }
  const unverified = facts.filter((f) => f.verification !== 'source_verified' && f.review_status !== 'rejected').length;
  if (unverified) {
    alerts.push({
      code: 'UNVERIFIED_FACTS', severity: 'low', source: 'system',
      title: `${unverified} unverified claim${unverified > 1 ? 's' : ''}`,
      message: 'The AI produced statements whose quotes could not be found in the documents. They are kept out of the statement of facts unless you confirm them.',
    });
  }

  return {
    workspace: { ...workspace, analysis_running: isRunning(workspace.id) },
    documents,
    facts,
    issues,
    statutes: summariseMentions(mentions).map((r) => ({ ...r, occurrences: r.occurrences.slice(0, 20) })),
    alerts,
    brief: brief ? { id: brief.id, revision: brief.revision, status: brief.status, approved_at: brief.approved_at, updated_at: brief.updated_at } : null,
    ai: describeAIProvider(),
  };
}

router.get('/workspaces/:id', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  res.json(await workspacePayload(workspace));
}));

router.patch('/workspaces/:id', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const data = validate(workspaceSchema.partial(), req.body);
  if (data.case_id) {
    const owned = await queryOne('SELECT id FROM cases WHERE id = ? AND user_id = ?', [data.case_id, req.userId]);
    if (!owned) return res.status(400).json({ error: 'case_id: case not found', code: 'VALIDATION_ERROR' });
  }
  const updated = await repo.updateWorkspace(workspace.id, req.userId, data);
  await repo.logAudit(workspace.id, req.userId, 'workspace_updated', 'workspace', workspace.id, { fields: Object.keys(data) });
  res.json(updated);
}));

router.delete('/workspaces/:id', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  if (isRunning(workspace.id)) return res.status(409).json({ error: 'Wait for the running analysis to finish before deleting.', code: 'ANALYSIS_RUNNING' });
  const { storageKeys } = await repo.deleteWorkspace(workspace.id, req.userId);
  await Promise.all(storageKeys.map((k) => deleteFile(k).catch((e) => console.warn('[case-prep] file delete failed:', e.message))));
  res.json({ deleted: true });
}));

router.get('/workspaces/:id/audit', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  res.json(await repo.listAudit(workspace.id));
}));

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
      if (!err) return resolve();
      const e = new Error(
        err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`
          : err.code === 'LIMIT_FILE_COUNT' ? `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`
            : 'The upload could not be processed.'
      );
      e.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      e.code = err.code || 'UPLOAD_ERROR';
      reject(e);
    });
  });
}

router.post('/workspaces/:id/documents', uploadLimiter, asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const storage = storageStatus();
  if (!storage.ready) {
    return res.status(503).json({ error: `Secure storage is not configured: ${storage.error}`, code: 'STORAGE_NOT_CONFIGURED' });
  }
  await runUpload(req, res);
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Attach at least one file in the "files" field.', code: 'NO_FILES' });

  const results = [];
  for (const file of files) {
    const name = decodeFilename(file.originalname || 'document');
    try {
      const { kind, mime } = sniffFile(file.buffer, name);
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const duplicate = await repo.findDocumentByHash(workspace.id, sha256);
      if (duplicate) {
        results.push({ name, ok: false, code: 'DUPLICATE', error: `Already uploaded as "${duplicate.original_name}".` });
        continue;
      }
      const extracted = await extractDocument(file.buffer, kind);
      const stored = await saveFile(file.buffer);
      const id = generateUUID();
      try {
        await repo.insertDocument({
          id,
          workspace_id: workspace.id,
          original_name: name,
          mime_type: mime,
          size_bytes: file.size,
          sha256,
          storage_key: stored.storageKey,
          encrypted: stored.encrypted,
          page_count: extracted.pageCount,
          char_count: extracted.charCount,
          extraction_method: extracted.method,
          status: extracted.status,
          error_message: extracted.note || null,
          statute_mentions: findStatuteMentions(extracted.passages),
        }, extracted.passages);
      } catch (dbError) {
        await deleteFile(stored.storageKey).catch(() => {});
        throw dbError;
      }
      await repo.logAudit(workspace.id, req.userId, 'document_uploaded', 'document', id, { name, mime, size: file.size, pages: extracted.pageCount, status: extracted.status });
      results.push({ name, ok: true, id, status: extracted.status, pages: extracted.pageCount, passages: extracted.passages.length, note: extracted.note || null });
    } catch (error) {
      if (error instanceof ExtractionError || error instanceof StorageConfigError) {
        results.push({ name, ok: false, code: error.code, error: error.message });
      } else {
        console.error('[case-prep] upload error:', error.name, error.message);
        results.push({ name, ok: false, code: 'UPLOAD_FAILED', error: 'The file could not be stored. Try again.' });
      }
    }
  }
  await repo.touchWorkspace(workspace.id);
  const okCount = results.filter((r) => r.ok).length;
  res.status(okCount ? 201 : 422).json({ results });
}));

async function loadDocument(req, res) {
  if (!UUID_RE.test(req.params.docId || '')) {
    notFound(res, 'Document');
    return null;
  }
  const doc = await repo.getDocumentForOwner(req.params.docId, req.userId);
  if (!doc) notFound(res, 'Document');
  return doc;
}

router.get('/documents/:docId/text', asyncRoute(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  const passages = await repo.getPassages(doc.id);
  const publicDoc = { ...doc };
  delete publicDoc.storage_key;
  res.json({ document: publicDoc, passages });
}));

const SAFE_INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']);

router.get('/documents/:docId/file', asyncRoute(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  const data = await readFile(doc.storage_key, doc.encrypted);
  const type = SAFE_INLINE_TYPES.has(doc.mime_type) ? doc.mime_type : 'application/octet-stream';
  res.set({
    'Content-Type': type === 'text/plain' ? 'text/plain; charset=utf-8' : type,
    'Content-Length': String(data.length),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(data);
}));

router.delete('/documents/:docId', asyncRoute(async (req, res) => {
  const doc = await loadDocument(req, res);
  if (!doc) return;
  if (isRunning(doc.workspace_id)) return res.status(409).json({ error: 'Wait for the running analysis to finish.', code: 'ANALYSIS_RUNNING' });
  await repo.deleteDocument(doc.id);
  await deleteFile(doc.storage_key).catch((e) => console.warn('[case-prep] file delete failed:', e.message));
  await repo.invalidateBriefApproval(doc.workspace_id);
  await repo.logAudit(doc.workspace_id, req.userId, 'document_deleted', 'document', doc.id, { name: doc.original_name });
  res.json({ deleted: true });
}));

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const analyseSchema = z.object({ scope: z.enum(['pending', 'all']).default('pending') });

router.post('/workspaces/:id/analyse', analyseLimiter, asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const { scope } = validate(analyseSchema, req.body);
  const ai = resolveAIConfig();
  if (ai.error) return res.status(503).json({ error: ai.error, code: 'AI_NOT_CONFIGURED' });
  if (isRunning(workspace.id)) return res.status(409).json({ error: 'Analysis is already running for this workspace.', code: 'ANALYSIS_RUNNING' });

  const documents = await repo.listDocuments(workspace.id);
  const runnable = documents.filter((d) => {
    if (d.status === 'needs_ocr' && !d.mime_type.startsWith('image/')) return false;
    return scope === 'all' || d.status !== 'analysed';
  });
  if (!runnable.length) {
    return res.status(400).json({
      error: documents.length ? 'Every readable document has already been analysed.' : 'Upload at least one document first.',
      code: documents.length ? 'NOTHING_TO_ANALYSE' : 'NO_DOCUMENTS',
    });
  }
  startAnalysis(workspace, req.userId, scope);
  res.status(202).json({ started: true, documents: runnable.length });
}));

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

const REVIEW_STATUSES = ['pending', 'accepted', 'edited', 'rejected'];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'invalid date');

const factPatchSchema = z.object({
  review_status: z.enum(REVIEW_STATUSES).optional(),
  statement: z.string().trim().min(5).max(2000).optional(),
  reviewer_note: z.string().trim().max(2000).optional().nullable(),
  event_date: isoDate.optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, 'nothing to update');

router.patch('/facts/:factId', asyncRoute(async (req, res) => {
  if (!UUID_RE.test(req.params.factId || '')) return notFound(res, 'Fact');
  const fact = await repo.getFactForOwner(req.params.factId, req.userId);
  if (!fact) return notFound(res, 'Fact');
  const data = validate(factPatchSchema, req.body);

  const fields = {};
  let edited = false;
  if (data.statement !== undefined && data.statement !== fact.statement) {
    fields.statement = data.statement;
    if (!fact.original_statement) fields.original_statement = fact.statement;
    edited = true;
  }
  if (data.event_date !== undefined) {
    fields.event_date = data.event_date;
    fields.date_precision = data.event_date ? 'day' : 'unknown';
    fields.date_flag = null;
    edited = true;
  }
  if (data.reviewer_note !== undefined) fields.reviewer_note = data.reviewer_note || null;
  if (data.review_status) fields.review_status = data.review_status;
  if (edited && data.review_status !== 'rejected') fields.review_status = 'edited';

  await repo.updateFact(fact.id, fields, req.userId);
  const invalidated = await repo.invalidateBriefApproval(fact.workspace_id);
  await repo.logAudit(fact.workspace_id, req.userId, 'fact_reviewed', 'fact', fact.id, {
    from: fact.review_status, to: fields.review_status || fact.review_status, edited, brief_approval_invalidated: invalidated,
  });
  const updated = (await repo.listFacts(fact.workspace_id)).find((f) => f.id === fact.id);
  res.json(updated);
}));

const factCreateSchema = z.object({
  statement: z.string().trim().min(5).max(2000),
  fact_type: z.enum(FACT_TYPES).default('other'),
  event_date: isoDate.optional().nullable(),
  date_text: z.string().trim().max(120).optional().nullable(),
  document_id: z.string().regex(UUID_RE).optional().nullable(),
  quote: z.string().trim().max(600).optional().nullable(),
}).refine((v) => !v.quote || v.document_id, { message: 'document_id is required with a quote', path: ['document_id'] });

router.post('/workspaces/:id/facts', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const data = validate(factCreateSchema, req.body);

  const citations = [];
  if (data.document_id) {
    const doc = await repo.getDocumentForOwner(data.document_id, req.userId);
    if (!doc || doc.workspace_id !== workspace.id) return res.status(400).json({ error: 'document_id: document not in this workspace', code: 'VALIDATION_ERROR' });
    if (data.quote) {
      const passages = await repo.getPassages(doc.id);
      const result = verifyCitation(passages, { quote: data.quote });
      if (!result.verified) {
        return res.status(422).json({ error: 'That quote was not found in the selected document. Copy the exact wording from the source.', code: 'QUOTE_NOT_FOUND' });
      }
      citations.push({
        document_id: doc.id, passage_id: result.passage.id, page_number: result.passage.page_number,
        quote: result.quote, quote_start: result.start, quote_end: result.end, match_type: result.matchType,
      });
    }
  }

  const factId = await repo.withTransaction((conn) => repo.insertFact(conn, {
    workspace_id: workspace.id,
    document_id: data.document_id || null,
    statement: data.statement,
    fact_type: data.fact_type,
    event_date: data.event_date || null,
    date_text: data.date_text || null,
    date_precision: data.event_date ? 'day' : 'unknown',
    verification: citations.length ? 'source_verified' : 'unverified',
    unverified_reason: citations.length ? null : 'Entered by reviewer without a source quote',
    review_status: 'accepted',
    origin: 'reviewer',
  }, citations));
  await repo.logAudit(workspace.id, req.userId, 'fact_added', 'fact', factId, { verified: citations.length > 0 });
  const created = (await repo.listFacts(workspace.id)).find((f) => f.id === factId);
  res.status(201).json(created);
}));

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const issuePatchSchema = z.object({
  review_status: z.enum(REVIEW_STATUSES).optional(),
  title: z.string().trim().min(3).max(500).optional(),
  analysis: z.string().trim().max(8000).optional(),
  reviewer_note: z.string().trim().max(2000).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, 'nothing to update');

router.patch('/issues/:issueId', asyncRoute(async (req, res) => {
  if (!UUID_RE.test(req.params.issueId || '')) return notFound(res, 'Issue');
  const issue = await repo.getIssueForOwner(req.params.issueId, req.userId);
  if (!issue) return notFound(res, 'Issue');
  const data = validate(issuePatchSchema, req.body);
  const fields = {};
  let edited = false;
  if (data.title !== undefined && data.title !== issue.title) { fields.title = data.title; edited = true; }
  if (data.analysis !== undefined && data.analysis !== issue.analysis) { fields.analysis = data.analysis; edited = true; }
  if (data.reviewer_note !== undefined) fields.reviewer_note = data.reviewer_note || null;
  if (data.review_status) fields.review_status = data.review_status;
  if (edited && data.review_status !== 'rejected') fields.review_status = 'edited';
  await repo.updateIssue(issue.id, fields, req.userId);
  const invalidated = await repo.invalidateBriefApproval(issue.workspace_id);
  await repo.logAudit(issue.workspace_id, req.userId, 'issue_reviewed', 'issue', issue.id, {
    from: issue.review_status, to: fields.review_status || issue.review_status, edited, brief_approval_invalidated: invalidated,
  });
  res.json(await repo.getIssueForOwner(issue.id, req.userId));
}));

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

async function briefResponse(workspace) {
  const [brief, facts, issues] = await Promise.all([repo.getBrief(workspace.id), repo.listFacts(workspace.id), repo.listIssues(workspace.id)]);
  if (!brief) return { brief: null, check: null };
  return { brief, check: approvalBlockers(brief.content, facts, issues) };
}

router.get('/workspaces/:id/brief', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  res.json(await briefResponse(workspace));
}));

router.post('/workspaces/:id/brief/generate', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const { overwrite } = validate(z.object({ overwrite: z.boolean().default(false) }), req.body);
  const existing = await repo.getBrief(workspace.id);
  if (existing && briefHasReviewerEdits(existing) && !overwrite) {
    return res.status(409).json({ error: 'The brief has reviewer edits. Regenerating will replace them.', code: 'BRIEF_HAS_EDITS' });
  }
  const [documents, facts, issues] = await Promise.all([repo.listDocuments(workspace.id), repo.listFacts(workspace.id), repo.listIssues(workspace.id)]);
  if (!facts.some((f) => f.review_status !== 'rejected')) {
    return res.status(400).json({ error: 'There are no facts yet. Upload documents and run analysis first.', code: 'NO_FACTS' });
  }
  const content = buildBrief({ workspace, documents, facts, issues });
  const brief = await repo.saveBrief(workspace.id, content, req.userId, existing ? existing.revision : undefined);
  await repo.logAudit(workspace.id, req.userId, existing ? 'brief_regenerated' : 'brief_generated', 'brief', brief.id, { revision: brief.revision });
  res.status(existing ? 200 : 201).json(await briefResponse(workspace));
}));

const briefSaveSchema = z.object({
  revision: z.number().int().positive(),
  sections: z.array(z.object({ id: z.string(), blocks: z.array(z.any()) }).passthrough()).max(20),
});

router.put('/workspaces/:id/brief', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const data = validate(briefSaveSchema, req.body);
  const existing = await repo.getBrief(workspace.id);
  if (!existing) return notFound(res, 'Brief');
  if (Number(existing.revision) !== data.revision) {
    return res.status(409).json({ error: 'The brief changed since you opened it. Reload to get the latest version.', code: 'REVISION_CONFLICT', currentRevision: existing.revision });
  }
  let content;
  try {
    content = applyBriefEdits(existing.content, { sections: data.sections });
  } catch (error) {
    if (error instanceof BriefValidationError) return res.status(400).json({ error: error.message, code: error.code });
    throw error;
  }
  const saved = await repo.saveBrief(workspace.id, content, req.userId, data.revision);
  if (!saved) return res.status(409).json({ error: 'The brief changed since you opened it. Reload to get the latest version.', code: 'REVISION_CONFLICT' });
  await repo.logAudit(workspace.id, req.userId, 'brief_edited', 'brief', saved.id, { revision: saved.revision, approval_cleared: existing.status === 'approved' });
  res.json(await briefResponse(workspace));
}));

const approveSchema = z.object({
  revision: z.number().int().positive(),
  attestation: z.literal(true, { errorMap: () => ({ message: 'you must confirm the review attestation' }) }),
  reviewer_name: z.string().trim().min(2).max(120),
});

router.post('/workspaces/:id/brief/approve', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const data = validate(approveSchema, req.body);
  const [brief, facts, issues] = await Promise.all([repo.getBrief(workspace.id), repo.listFacts(workspace.id), repo.listIssues(workspace.id)]);
  if (!brief) return notFound(res, 'Brief');
  if (Number(brief.revision) !== data.revision) {
    return res.status(409).json({ error: 'The brief changed since you reviewed it. Reload and review again.', code: 'REVISION_CONFLICT' });
  }
  const check = approvalBlockers(brief.content, facts, issues);
  if (check.blockers.length) {
    return res.status(409).json({ error: 'The brief cannot be approved until every fact and analysis it relies on has been reviewed.', code: 'REVIEW_INCOMPLETE', ...check });
  }
  const attestation = `${data.reviewer_name} confirmed that every fact in revision ${brief.revision} was checked against its source and every AI analysis was reviewed before approval.`;
  const ok = await repo.approveBrief(workspace.id, data.revision, req.userId, attestation);
  if (!ok) return res.status(409).json({ error: 'The brief changed while approving. Reload and try again.', code: 'REVISION_CONFLICT' });
  await repo.logAudit(workspace.id, req.userId, 'brief_approved', 'brief', brief.id, { revision: brief.revision, reviewer_name: data.reviewer_name, warnings: check.warnings.length });
  res.json(await briefResponse(workspace));
}));

router.post('/workspaces/:id/brief/export-log', asyncRoute(async (req, res) => {
  const workspace = await loadWorkspace(req, res);
  if (!workspace) return;
  const { format } = validate(z.object({ format: z.enum(['pdf', 'markdown']) }), req.body);
  const brief = await repo.getBrief(workspace.id);
  if (!brief) return notFound(res, 'Brief');
  await repo.logAudit(workspace.id, req.userId, 'brief_exported', 'brief', brief.id, { format, revision: brief.revision, status: brief.status });
  res.json({ logged: true });
}));

// ---------------------------------------------------------------------------
// Errors (JSON, no stack traces or document content)
// ---------------------------------------------------------------------------

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[case-prep] error:', err.name, err.message);
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message,
    code: err.code || (status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST'),
  });
});

export default router;
