// Background analysis runner for case-preparation workspaces.
// Express runs as one long-lived process on the VPS, so an in-process queue
// is enough: one analysis per workspace at a time. Work interrupted by a
// restart is marked failed on boot (repo.recoverInterruptedAnalyses) and can
// simply be run again.

import { AIProviderError } from '../ai-provider.js';
import { ExtractionError, pagesToPassages } from './extract.js';
import { findStatuteMentions } from './legal-rules.js';
import { analyseIssues, extractFactsFromDocument, transcribeImage } from './analysis.js';
import { readFile } from './storage.js';
import * as repo from './repo.js';
import { query } from '../mysql.js';

const running = new Map();

export function isRunning(workspaceId) {
  return running.has(workspaceId);
}

/** Promise for the analysis currently running in a workspace (used by tests). */
export function getRunningJob(workspaceId) {
  return running.get(workspaceId) || null;
}

function safeMessage(error) {
  if (error instanceof AIProviderError || error instanceof ExtractionError) return error.message;
  return 'Unexpected error during analysis. Try again; if it keeps failing, contact support.';
}

// These stop the whole run: every remaining document would fail the same way.
const FATAL_CODES = new Set(['NOT_CONFIGURED', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT']);

async function reviewedStatements(documentId) {
  const rows = await query(
    `SELECT statement, original_statement FROM case_prep_facts
     WHERE document_id = ? AND NOT (origin = 'ai' AND review_status = 'pending')`,
    [documentId]
  );
  return rows.flatMap((r) => [r.statement, r.original_statement].filter(Boolean));
}

async function analyseDocument(doc, workspace, userId) {
  await repo.updateDocument(doc.id, { status: 'analysing', error_message: null });

  let passages = await repo.getPassages(doc.id);
  if (!passages.length && doc.mime_type.startsWith('image/')) {
    const full = await repo.getDocumentInternal(doc.id);
    const buffer = await readFile(full.storage_key, full.encrypted);
    const text = await transcribeImage({ buffer, mime: doc.mime_type, userId, caseId: workspace.case_id });
    const newPassages = pagesToPassages([text]);
    if (!newPassages.length) throw new ExtractionError('NO_TEXT', 'No readable text was found in this image.');
    await repo.replacePassages(doc.id, workspace.id, newPassages);
    passages = await repo.getPassages(doc.id);
    await repo.updateDocument(doc.id, {
      extraction_method: 'vision_ocr',
      page_count: 1,
      char_count: text.length,
      statute_mentions: findStatuteMentions(passages),
    });
  }
  if (!passages.length) {
    throw new ExtractionError('NO_TEXT', 'This document has no extractable text. Scanned PDFs are not supported yet: upload page images or a PDF with a text layer.');
  }

  const { facts, docType, language } = await extractFactsFromDocument({
    document: doc,
    passages,
    workspaceId: workspace.id,
    userId,
    caseId: workspace.case_id,
    existingStatements: await reviewedStatements(doc.id),
  });

  await repo.withTransaction(async (conn) => {
    await repo.deletePendingAiFactsForDocument(conn, doc.id);
    for (const fact of facts) await repo.insertFact(conn, fact, fact.citations);
  });

  await repo.updateDocument(doc.id, {
    status: 'analysed',
    doc_type: docType,
    document_language: language,
    error_message: null,
    analysed_at: new Date(),
  });
  return facts;
}

async function runAnalysis(workspace, userId, scope) {
  await repo.setAnalysisState(workspace.id, 'running');
  await repo.logAudit(workspace.id, userId, 'analysis_started', 'workspace', workspace.id, { scope });
  const summary = { documents: 0, facts: 0, verified: 0, unverified: 0, failedDocuments: 0, issues: 0 };

  try {
    const documents = await repo.listDocuments(workspace.id);
    for (const doc of documents) {
      if (scope !== 'all' && doc.status === 'analysed') continue;
      const scannedPdf = doc.status === 'needs_ocr' && !doc.mime_type.startsWith('image/');
      if (scannedPdf) continue;
      try {
        const facts = await analyseDocument(doc, workspace, userId);
        summary.documents++;
        summary.facts += facts.length;
        summary.verified += facts.filter((f) => f.verification === 'source_verified').length;
        summary.unverified += facts.filter((f) => f.verification !== 'source_verified').length;
      } catch (error) {
        summary.failedDocuments++;
        if (!(error instanceof AIProviderError) && !(error instanceof ExtractionError)) {
          console.error('[case-prep] document analysis error:', error.name, error.message);
        }
        await repo.updateDocument(doc.id, { status: 'failed', error_message: safeMessage(error).slice(0, 500) });
        if (error instanceof AIProviderError && FATAL_CODES.has(error.code)) throw error;
      }
    }

    const facts = await repo.listFacts(workspace.id);
    if (facts.some((f) => f.review_status !== 'rejected')) {
      const issues = await analyseIssues({ workspace, facts, userId });
      await repo.replacePendingAiIssues(workspace.id, issues);
      summary.issues = issues.length;
    }

    await repo.setAnalysisState(workspace.id, 'idle');
    await repo.touchWorkspace(workspace.id);
    await repo.logAudit(workspace.id, userId, 'analysis_completed', 'workspace', workspace.id, summary);
    return summary;
  } catch (error) {
    if (!(error instanceof AIProviderError) && !(error instanceof ExtractionError)) {
      console.error('[case-prep] analysis error:', error.name, error.message);
    }
    await repo.setAnalysisState(workspace.id, 'failed', safeMessage(error));
    await repo.logAudit(workspace.id, userId, 'analysis_failed', 'workspace', workspace.id, { ...summary, error: safeMessage(error) });
    return { ...summary, error: safeMessage(error) };
  }
}

/** Start analysis in the background. Throws if one is already running. */
export function startAnalysis(workspace, userId, scope = 'pending') {
  if (running.has(workspace.id)) {
    const err = new Error('Analysis is already running for this workspace.');
    err.status = 409;
    err.code = 'ANALYSIS_RUNNING';
    throw err;
  }
  const job = runAnalysis(workspace, userId, scope).finally(() => running.delete(workspace.id));
  running.set(workspace.id, job);
  return job;
}
