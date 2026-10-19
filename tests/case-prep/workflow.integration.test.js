// End-to-end workflow against a real database and a local mock AI provider:
// upload -> extract -> analyse -> verify citations -> review -> brief -> approve.
import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../server/lib/mysql.js';
import { signUp } from '../../server/lib/auth.js';
import { FIR_PAGES, TINY_PNG, makePdf, makeScannedPdf } from '../helpers/fixtures.js';
import { startMockAI } from '../helpers/mock-ai.js';

async function databaseReady() {
  try {
    await query('SELECT 1 FROM case_prep_workspaces LIMIT 1');
    return true;
  } catch (error) {
    console.warn(`[workflow.integration] skipped: test database unavailable (${error.code || error.message}). See tests/setup/env.js.`);
    return false;
  }
}

const dbReady = await databaseReady();

describe.skipIf(!dbReady)('case preparation workflow (integration)', () => {
  let app;
  let jobs;
  let limiters;
  let ai;
  let owner;
  let intruder;
  let workspaceId;
  let pdfDocId;
  const firPdf = makePdf(FIR_PAGES);

  const as = (user) => ({
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${user.token}`),
    post: (url) => request(app).post(url).set('Authorization', `Bearer ${user.token}`),
    patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${user.token}`),
    put: (url) => request(app).put(url).set('Authorization', `Bearer ${user.token}`),
    del: (url) => request(app).delete(url).set('Authorization', `Bearer ${user.token}`),
  });

  async function makeUser(label) {
    const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.enyayasetu.local`;
    const { data, error } = await signUp(email, 'Str0ng-passw0rd!', { display_name: label });
    if (error) throw error;
    return { id: data.user.id, email, token: data.session.access_token };
  }

  async function workspace(user = owner) {
    const res = await as(user).get(`/api/case-prep/workspaces/${workspaceId}`);
    expect(res.status).toBe(200);
    return res.body;
  }

  function enableAI() {
    process.env.AI_API_BASE_URL = ai.url;
    process.env.AI_MODEL = 'mock-legal-model';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_VISION = 'true';
  }

  beforeAll(async () => {
    ({ default: app } = await import('../../server/app.js'));
    jobs = await import('../../server/lib/case-prep/jobs.js');
    limiters = await import('../../server/routes/case-prep.js');
    ai = await startMockAI();
    owner = await makeUser('advocate');
    intruder = await makeUser('intruder');
  });

  afterAll(async () => {
    await ai?.close();
    if (owner && intruder) {
      await query('DELETE FROM ai_usage_logs WHERE user_id IN (?, ?)', [owner.id, intruder.id]);
      await query('DELETE FROM users WHERE id IN (?, ?)', [owner.id, intruder.id]);
    }
    await fs.rm(process.env.CASE_PREP_STORAGE_DIR, { recursive: true, force: true });
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/case-prep/workspaces')).status).toBe(401);
    expect((await request(app).get('/api/case-prep/workspaces').set('Authorization', 'Bearer forged.token.value')).status).toBe(401);
  });

  it('validates and creates a workspace', async () => {
    const bad = await as(owner).post('/api/case-prep/workspaces').send({ title: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');

    const res = await as(owner).post('/api/case-prep/workspaces').send({
      title: 'State v. Suresh Sharma', matter_type: 'criminal', forum: 'CJM Court, Jaipur', client_side: 'Complainant',
    });
    expect(res.status).toBe(201);
    workspaceId = res.body.id;

    const empty = await workspace();
    expect(empty.documents).toEqual([]);
    expect(empty.facts).toEqual([]);
    expect(empty.ai.configured).toBe(false);
  });

  it('isolates workspaces between users', async () => {
    expect((await as(intruder).get(`/api/case-prep/workspaces/${workspaceId}`)).status).toBe(404);
    expect((await as(intruder).get('/api/case-prep/workspaces')).body).toEqual([]);
    expect((await as(intruder).post(`/api/case-prep/workspaces/${workspaceId}/documents`).attach('files', firPdf, 'fir.pdf')).status).toBe(404);
    expect((await as(intruder).del(`/api/case-prep/workspaces/${workspaceId}`)).status).toBe(404);
    expect((await as(owner).get('/api/case-prep/workspaces/not-a-uuid')).status).toBe(404);
  });

  it('uploads a PDF, extracts page-anchored text and finds statute references in it', async () => {
    const res = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/documents`).attach('files', firPdf, 'FIR 245-2024.pdf');
    expect(res.status).toBe(201);
    expect(res.body.results[0]).toMatchObject({ ok: true, status: 'extracted', pages: 2 });
    pdfDocId = res.body.results[0].id;

    const ws = await workspace();
    expect(ws.documents[0]).toMatchObject({ original_name: 'FIR 245-2024.pdf', mime_type: 'application/pdf', page_count: 2, encrypted: true });
    expect(ws.documents[0]).not.toHaveProperty('storage_key');
    expect(ws.statutes[0]).toMatchObject({ act_key: 'IPC', sections: ['379'] });

    const text = await as(owner).get(`/api/case-prep/documents/${pdfDocId}/text`);
    expect(text.status).toBe(200);
    expect(text.body.passages.map((p) => p.label)).toEqual(['p1.1', 'p2.1']);
    expect(text.body.document).not.toHaveProperty('storage_key');
    expect((await as(intruder).get(`/api/case-prep/documents/${pdfDocId}/text`)).status).toBe(404);
  });

  it('serves the original file only to its owner, encrypted at rest', async () => {
    const res = await as(owner).get(`/api/case-prep/documents/${pdfDocId}/file`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body, firPdf)).toBe(0);
    expect((await as(intruder).get(`/api/case-prep/documents/${pdfDocId}/file`)).status).toBe(404);

    const [row] = await query('SELECT storage_key FROM case_prep_documents WHERE id = ?', [pdfDocId]);
    const onDisk = await fs.readFile(path.join(process.env.CASE_PREP_STORAGE_DIR, row.storage_key.slice(0, 2), row.storage_key));
    expect(onDisk.subarray(0, 5).toString()).not.toBe('%PDF-');
  });

  it('rejects duplicates, disguised executables, Office files and scanned PDFs are flagged', async () => {
    const res = await as(owner)
      .post(`/api/case-prep/workspaces/${workspaceId}/documents`)
      .attach('files', firPdf, 'copy.pdf')
      .attach('files', Buffer.from('MZ\x90\x00 not really a pdf'), 'evil.pdf')
      .attach('files', Buffer.from('PK\x03\x04 word file'), 'brief.docx')
      .attach('files', makeScannedPdf(), 'scan.pdf');
    expect(res.status).toBe(201);
    const byName = Object.fromEntries(res.body.results.map((r) => [r.name, r]));
    expect(byName['copy.pdf']).toMatchObject({ ok: false, code: 'DUPLICATE' });
    expect(byName['evil.pdf']).toMatchObject({ ok: false, code: 'UNSUPPORTED_TYPE' });
    expect(byName['brief.docx']).toMatchObject({ ok: false, code: 'UNSUPPORTED_TYPE' });
    expect(byName['scan.pdf']).toMatchObject({ ok: true, status: 'needs_ocr' });

    const ws = await workspace();
    expect(ws.alerts.map((a) => a.code)).toContain('SCANNED_PDF');
  });

  it('refuses to analyse without a configured AI provider instead of faking output', async () => {
    const res = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/analyse`).send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  });

  it('analyses documents and keeps only quotes that exist in the source as citations', async () => {
    enableAI();
    // An image (OCR through the vision model) alongside the PDF.
    const img = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/documents`).attach('files', TINY_PNG, 'notice-photo.png');
    expect(img.body.results[0]).toMatchObject({ ok: true, status: 'needs_ocr' });

    const res = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/analyse`).send({});
    expect(res.status).toBe(202);
    expect((await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/analyse`).send({})).status).toBe(409);
    const summary = await jobs.getRunningJob(workspaceId);
    expect(summary.error).toBeUndefined();

    const ws = await workspace();
    expect(ws.workspace.analysis_status).toBe('idle');
    const pdfFacts = ws.facts.filter((f) => f.document_id === pdfDocId);
    expect(pdfFacts).toHaveLength(4); // duplicate dropped

    const theft = pdfFacts.find((f) => f.statement.includes('reported theft'));
    expect(theft).toMatchObject({ verification: 'source_verified', event_date: '2024-08-12', review_status: 'pending', origin: 'ai' });
    expect(theft.date_flag).toMatch(/2024-12-08/);
    expect(theft.citations[0]).toMatchObject({ page_number: 1, passage_label: 'p1.1', quote: 'the complainant Ramesh Kumar reported theft of his motorcycle' });

    const witness = pdfFacts.find((f) => f.statement.includes('Anita Devi'));
    expect(witness.citations[0]).toMatchObject({ page_number: 2, passage_label: 'p2.1' });

    const confession = pdfFacts.find((f) => f.statement.includes('confessed'));
    expect(confession).toMatchObject({ verification: 'unverified', citations: [] });
    expect(confession.claimed_sources[0].quote).toMatch(/confessed/);

    const registered = pdfFacts.find((f) => f.statement.includes('registered'));
    expect(registered.citations[0]).toMatchObject({ match_type: 'normalized', quote: 'Case registered u/s 379 IPC' });

    // OCR'd image became cited source text too.
    const image = ws.documents.find((d) => d.original_name === 'notice-photo.png');
    expect(image).toMatchObject({ status: 'analysed', extraction_method: 'vision_ocr' });
    expect(image.statute_mentions[0]).toMatchObject({ act_key: 'NI', sections: ['138'] });

    // Scanned PDF stays flagged rather than silently "analysed".
    expect(ws.documents.find((d) => d.original_name === 'scan.pdf').status).toBe('needs_ocr');

    // Rule-based India check: IPC cited for an August 2024 incident.
    expect(ws.alerts.find((a) => a.code === 'IPC_AFTER_BNS')).toMatchObject({ severity: 'high', source: 'rule' });
  });

  it('grounds issues in facts and strips unverifiable authorities', async () => {
    const ws = await workspace();
    const issue = ws.issues.find((i) => i.title.includes('theft'));
    expect(issue.fact_ids).toHaveLength(2);
    expect(issue.fact_ids.every((id) => ws.facts.some((f) => f.id === id))).toBe(true);
    expect(issue.analysis).not.toMatch(/SCC|https?:/);
    expect(issue.sanitation_notes.length).toBeGreaterThan(0);
    expect(issue.provisions.every((p) => p.authority_status === 'unverified')).toBe(true);
    expect(issue.provisions.find((p) => p.act.includes('Imaginary'))).toMatchObject({ act_recognised: false });
  });

  it('sends document text as delimited, untrusted data and never sends the API key elsewhere', () => {
    const factCall = ai.requests.find((r) => r.body.messages[0].content.includes('You extract facts')
      && r.body.messages[1].content.includes('Document name: FIR 245-2024.pdf'));
    expect(factCall.headers.authorization).toBe('Bearer test-key');
    expect(factCall.body.messages[0].content).toMatch(/untrusted data/);
    expect(factCall.body.messages[1].content).toMatch(/<<<PASSAGE p2\.1 \(page 2\)>>>[\s\S]*Ignore all previous instructions[\s\S]*<<<END PASSAGE p2\.1>>>/);
    expect(factCall.body.temperature).toBe(0);
  });

  it('requires human review before the brief can be approved', async () => {
    const gen = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/generate`).send({});
    expect(gen.status).toBe(201);
    const { brief, check } = gen.body;
    const factsSection = brief.content.sections.find((s) => s.id === 'facts');
    const unverifiedSection = brief.content.sections.find((s) => s.id === 'unverified');
    const ws = await workspace();
    const confession = ws.facts.find((f) => f.statement.includes('confessed'));
    expect(factsSection.blocks.some((b) => b.fact_id === confession.id)).toBe(false);
    expect(unverifiedSection.blocks[0].fact_ids).toContain(confession.id);
    expect(check.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['FACT_NOT_REVIEWED', 'ISSUE_NOT_REVIEWED']));

    const premature = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/approve`)
      .send({ revision: brief.revision, attestation: true, reviewer_name: 'Adv. Meera Rao' });
    expect(premature.status).toBe(409);
    expect(premature.body.code).toBe('REVIEW_INCOMPLETE');

    // Reviewer works through facts and issues.
    for (const f of ws.facts) {
      const status = f.verification === 'source_verified' ? 'accepted' : 'rejected';
      const r = await as(owner).patch(`/api/case-prep/facts/${f.id}`).send({ review_status: status });
      expect(r.status).toBe(200);
    }
    expect((await as(intruder).patch(`/api/case-prep/facts/${ws.facts[0].id}`).send({ review_status: 'rejected' })).status).toBe(404);
    for (const i of ws.issues) {
      expect((await as(owner).patch(`/api/case-prep/issues/${i.id}`).send({ review_status: 'accepted' })).status).toBe(200);
    }

    const noAttestation = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/approve`)
      .send({ revision: brief.revision, attestation: false, reviewer_name: 'Adv. Meera Rao' });
    expect(noAttestation.status).toBe(400);

    const ok = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/approve`)
      .send({ revision: brief.revision, attestation: true, reviewer_name: 'Adv. Meera Rao' });
    expect(ok.status).toBe(200);
    expect(ok.body.brief).toMatchObject({ status: 'approved' });
    expect(ok.body.brief.approval_attestation).toMatch(/Adv\. Meera Rao/);
  });

  it('protects provenance in edits, detects stale revisions and drops approval on change', async () => {
    const { body } = await as(owner).get(`/api/case-prep/workspaces/${workspaceId}/brief`);
    const { brief } = body;
    const sections = structuredClone(brief.content.sections);
    const facts = sections.find((s) => s.id === 'facts');
    const target = facts.blocks[0];
    facts.blocks[0] = { ...target, text: 'Edited wording of the fact.', kind: 'note', origin: 'reviewer', fact_id: '00000000-0000-4000-8000-000000000000' };
    sections.find((s) => s.id === 'notes').blocks.push({ id: 'note-0000-1111', kind: 'note', text: 'Call the witness first.' });

    const saved = await as(owner).put(`/api/case-prep/workspaces/${workspaceId}/brief`).send({ revision: brief.revision, sections });
    expect(saved.status).toBe(200);
    const savedFact = saved.body.brief.content.sections.find((s) => s.id === 'facts').blocks[0];
    expect(savedFact).toMatchObject({ kind: 'fact', origin: 'source', fact_id: target.fact_id, edited: true, text: 'Edited wording of the fact.' });
    expect(saved.body.brief.status).toBe('draft'); // approval cleared by the edit

    const stale = await as(owner).put(`/api/case-prep/workspaces/${workspaceId}/brief`).send({ revision: brief.revision, sections });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REVISION_CONFLICT');

    const forged = structuredClone(saved.body.brief.content.sections);
    forged.find((s) => s.id === 'facts').blocks.push({ id: 'forged-block-1', kind: 'fact', fact_id: target.fact_id, text: 'Invented fact' });
    const forgedRes = await as(owner).put(`/api/case-prep/workspaces/${workspaceId}/brief`).send({ revision: saved.body.brief.revision, sections: forged });
    expect(forgedRes.status).toBe(400);

    // Re-approve, then change a reviewed fact: approval must drop.
    const re = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/approve`)
      .send({ revision: saved.body.brief.revision, attestation: true, reviewer_name: 'Adv. Meera Rao' });
    expect(re.status).toBe(200);
    await as(owner).patch(`/api/case-prep/facts/${target.fact_id}`).send({ review_status: 'rejected' });
    const after = await as(owner).get(`/api/case-prep/workspaces/${workspaceId}/brief`);
    expect(after.body.brief.status).toBe('draft');
    expect(after.body.check.blockers.map((b) => b.code)).toContain('FACT_REJECTED');

    const regen = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/brief/generate`).send({});
    expect(regen.status).toBe(409);
    expect(regen.body.code).toBe('BRIEF_HAS_EDITS');
  });

  it('accepts reviewer facts only with quotes that exist in the document', async () => {
    const bad = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/facts`).send({
      statement: 'The motorcycle was recovered.', document_id: pdfDocId, quote: 'motorcycle was recovered from the accused',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('QUOTE_NOT_FOUND');

    const good = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/facts`).send({
      statement: 'FIR No. 245/2024 was registered at PS Kotwali, Jaipur.', fact_type: 'document', document_id: pdfDocId,
      quote: 'FIR No. 245/2024, Police Station Kotwali, Jaipur',
    });
    expect(good.status).toBe(201);
    expect(good.body).toMatchObject({ verification: 'source_verified', origin: 'reviewer', review_status: 'accepted' });
    expect(good.body.citations[0].page_number).toBe(1);
  });

  it('records an audit trail of every consequential step', async () => {
    const res = await as(owner).get(`/api/case-prep/workspaces/${workspaceId}/audit`);
    const actions = res.body.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'workspace_created', 'document_uploaded', 'analysis_started', 'analysis_completed', 'brief_generated', 'fact_reviewed', 'brief_approved', 'brief_edited', 'fact_added',
    ]));
    expect((await as(intruder).get(`/api/case-prep/workspaces/${workspaceId}/audit`)).status).toBe(404);
  });

  it('rate-limits analysis runs per user', async () => {
    limiters.analyseLimiter.reset();
    let last;
    for (let i = 0; i < 7; i++) {
      last = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/analyse`).send({ scope: 'pending' });
    }
    expect(last.status).toBe(429);
    limiters.analyseLimiter.reset();
  });

  it('reports provider failures without leaking details', async () => {
    const broken = await startMockAI({ mode: 'error' });
    process.env.AI_API_BASE_URL = broken.url;
    try {
      const res = await as(owner).post(`/api/case-prep/workspaces/${workspaceId}/analyse`).send({ scope: 'all' });
      expect(res.status).toBe(202);
      const summary = await jobs.getRunningJob(workspaceId);
      expect(summary.error).toMatch(/AI provider returned an error \(500\)/);
      const ws = await workspace();
      expect(ws.workspace.analysis_status).toBe('failed');
      // Reviewed facts survive a failed re-run.
      expect(ws.facts.filter((f) => f.review_status !== 'pending').length).toBeGreaterThan(0);
    } finally {
      await broken.close();
      enableAI();
      limiters.analyseLimiter.reset();
    }
  });

  it('deletes a workspace and its stored files', async () => {
    const [{ storage_key: key }] = await query('SELECT storage_key FROM case_prep_documents WHERE id = ?', [pdfDocId]);
    const res = await as(owner).del(`/api/case-prep/workspaces/${workspaceId}`);
    expect(res.status).toBe(200);
    expect((await as(owner).get(`/api/case-prep/workspaces/${workspaceId}`)).status).toBe(404);
    await expect(fs.access(path.join(process.env.CASE_PREP_STORAGE_DIR, key.slice(0, 2), key))).rejects.toThrow();
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM case_prep_passages WHERE document_id = ?', [pdfDocId]);
    expect(Number(n)).toBe(0);
  });
});
