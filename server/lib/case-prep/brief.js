// Case brief assembly, edit validation and the human-review gate.
//
// A brief is a list of sections made of typed blocks. Provenance lives on the
// server: the client may edit the text of a block, delete blocks, reorder
// them inside a section and add reviewer notes, but it can never change a
// block's kind, origin or the fact/issue it points at. Citations are resolved
// from the referenced fact at read time, so they cannot be forged in an edit.

import crypto from 'crypto';
import { summariseMentions } from './legal-rules.js';

export const SECTION_DEFS = [
  { id: 'overview', title: 'Matter overview' },
  { id: 'facts', title: 'Statement of facts' },
  { id: 'chronology', title: 'Chronology' },
  { id: 'issues', title: 'Issues for consideration' },
  { id: 'statutes', title: 'Provisions cited in the documents' },
  { id: 'suggested', title: 'Provisions suggested by AI (authority not verified)' },
  { id: 'gaps', title: 'Evidence gaps and next steps' },
  { id: 'unverified', title: 'Unverified claims (excluded from the statement of facts)' },
  { id: 'notes', title: 'Reviewer notes' },
];

const EDITABLE_KINDS = new Set(['context', 'fact', 'analysis', 'note']);
const MAX_BLOCK_TEXT = 8000;
const REVIEWED = new Set(['accepted', 'edited']);

const newId = () => crypto.randomUUID();

function block(kind, origin, fields) {
  return { id: newId(), kind, origin, edited: false, ...fields };
}

export function isIncludedFact(fact) {
  if (fact.review_status === 'rejected') return false;
  if (fact.verification === 'source_verified') return true;
  // An unverified fact enters the statement of facts only if a reviewer vouched for it.
  return REVIEWED.has(fact.review_status);
}

const MATTER_LABEL = {
  criminal: 'Criminal', civil: 'Civil', family: 'Family', consumer: 'Consumer',
  corporate: 'Corporate', constitutional: 'Constitutional / writ', other: 'Other',
};

export function buildBrief({ workspace, documents, facts, issues }) {
  const included = facts.filter(isIncludedFact);
  const unverified = facts.filter((f) => f.review_status !== 'rejected' && !isIncludedFact(f));
  const liveIssues = issues.filter((i) => i.review_status !== 'rejected');

  const overview = [
    `Matter: ${workspace.title}`,
    `Type: ${MATTER_LABEL[workspace.matter_type] || workspace.matter_type}`,
    workspace.forum ? `Forum: ${workspace.forum}` : null,
    workspace.client_side ? `Acting for: ${workspace.client_side}` : null,
    `Documents reviewed: ${documents.map((d) => d.original_name).join('; ') || 'none'}`,
  ].filter(Boolean).join('\n');

  const sections = {
    overview: [block('context', 'workspace', { text: overview, source_text: overview })],
    facts: included.map((f) => block('fact', f.verification === 'source_verified' ? 'source' : 'reviewer_confirmed', {
      fact_id: f.id, text: f.statement, source_text: f.statement,
    })),
    chronology: [block('chronology', 'derived', {
      fact_ids: included.filter((f) => f.event_date).map((f) => f.id),
    })],
    issues: liveIssues.map((i) => block('analysis', 'ai', {
      issue_id: i.id, title: i.title, text: i.analysis || '', source_text: i.analysis || '',
    })),
    statutes: [block('statutes', 'source', {
      items: summariseMentions(documents.flatMap((d) => (d.statute_mentions || []).map((m) => ({ ...m, document_id: d.id, document_name: d.original_name }))))
        .map((r) => ({
          act_key: r.act_key,
          act_label: r.act_label,
          unit: r.unit,
          sections: r.sections,
          occurrences: r.occurrences.slice(0, 10).map((o) => ({
            document_id: o.document_id, document_name: o.document_name, page_number: o.page_number, passage_label: o.passage_label, snippet: o.snippet,
          })),
        })),
    })],
    suggested: [block('suggested_provisions', 'ai', {
      items: liveIssues.flatMap((i) => (i.provisions || []).map((p) => ({ ...p, issue_title: i.title }))),
    })],
    gaps: [block('gaps', 'ai', {
      items: [...new Set(liveIssues.flatMap((i) => i.evidence_gaps || []))],
    })],
    unverified: [block('unverified', 'ai', { fact_ids: unverified.map((f) => f.id) })],
    notes: [],
  };

  return {
    generated_at: new Date().toISOString(),
    sections: SECTION_DEFS.map((s) => ({ id: s.id, title: s.title, blocks: sections[s.id] })),
  };
}

export class BriefValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'INVALID_BRIEF';
  }
}

/**
 * Merge a client-submitted brief into the stored one, keeping server-side
 * provenance. Returns the new content.
 */
export function applyBriefEdits(existing, submitted) {
  if (!submitted || !Array.isArray(submitted.sections)) throw new BriefValidationError('sections must be an array');
  const existingSections = new Map(existing.sections.map((s) => [s.id, s]));
  const seenBlockIds = new Set();

  const sections = existing.sections.map((section) => {
    const incoming = submitted.sections.find((s) => s?.id === section.id);
    if (!incoming) return section; // untouched section
    if (!Array.isArray(incoming.blocks)) throw new BriefValidationError(`Section ${section.id}: blocks must be an array`);
    const known = new Map(section.blocks.map((b) => [b.id, b]));

    const blocks = incoming.blocks.map((b) => {
      if (!b || typeof b.id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.id)) throw new BriefValidationError('Every block needs a valid id');
      if (seenBlockIds.has(b.id)) throw new BriefValidationError('Duplicate block id');
      seenBlockIds.add(b.id);

      const original = known.get(b.id);
      if (!original) {
        // Only reviewer notes can be created by the client.
        if (b.kind !== 'note') throw new BriefValidationError('Only reviewer notes can be added to a brief');
        const text = typeof b.text === 'string' ? b.text.trim().slice(0, MAX_BLOCK_TEXT) : '';
        return { id: b.id, kind: 'note', origin: 'reviewer', edited: false, text };
      }
      if (!EDITABLE_KINDS.has(original.kind) || typeof b.text !== 'string') return original;
      const text = b.text.slice(0, MAX_BLOCK_TEXT);
      return {
        ...original,
        text,
        edited: original.kind === 'note' ? false : text.trim() !== String(original.source_text ?? '').trim(),
      };
    });
    return { ...section, blocks };
  });

  for (const s of submitted.sections) {
    if (!existingSections.has(s?.id)) throw new BriefValidationError(`Unknown section: ${s?.id}`);
  }
  return { ...existing, sections, last_edited_at: new Date().toISOString() };
}

/**
 * What stops this brief from being approved. Approval is a human decision:
 * every fact and AI analysis the brief relies on must have been reviewed.
 */
export function approvalBlockers(content, facts, issues) {
  const factById = new Map(facts.map((f) => [f.id, f]));
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const blockers = [];
  const warnings = [];
  let factBlocks = 0;

  const short = (t) => (t.length > 80 ? `${t.slice(0, 77)}...` : t);

  for (const section of content.sections || []) {
    for (const b of section.blocks || []) {
      if (b.kind === 'fact') {
        factBlocks++;
        const fact = factById.get(b.fact_id);
        if (!fact) blockers.push({ code: 'FACT_MISSING', message: 'A fact in the brief no longer exists. Regenerate or remove it.', block_id: b.id });
        else if (fact.review_status === 'rejected') blockers.push({ code: 'FACT_REJECTED', message: `Rejected fact still in brief: "${short(fact.statement)}"`, block_id: b.id, fact_id: fact.id });
        else if (!REVIEWED.has(fact.review_status)) blockers.push({ code: 'FACT_NOT_REVIEWED', message: `Fact not yet reviewed: "${short(fact.statement)}"`, block_id: b.id, fact_id: fact.id });
        else if (fact.verification !== 'source_verified') warnings.push({ code: 'FACT_NO_SOURCE', message: `Reviewer-confirmed fact with no source link: "${short(fact.statement)}"`, fact_id: fact.id });
      }
      if (b.kind === 'analysis') {
        const issue = issueById.get(b.issue_id);
        if (!issue) blockers.push({ code: 'ISSUE_MISSING', message: 'An issue in the brief no longer exists. Regenerate or remove it.', block_id: b.id });
        else if (!REVIEWED.has(issue.review_status)) blockers.push({ code: 'ISSUE_NOT_REVIEWED', message: `AI analysis not yet reviewed: "${short(issue.title)}"`, block_id: b.id, issue_id: issue.id });
      }
      if (b.kind === 'chronology') {
        for (const id of b.fact_ids || []) {
          const fact = factById.get(id);
          if (fact && fact.review_status === 'rejected') blockers.push({ code: 'CHRONOLOGY_REJECTED', message: `Chronology includes a rejected fact: "${short(fact.statement)}"`, fact_id: id });
          else if (fact && !REVIEWED.has(fact.review_status)) blockers.push({ code: 'CHRONOLOGY_NOT_REVIEWED', message: `Chronology entry not yet reviewed: "${short(fact.statement)}"`, fact_id: id });
        }
      }
      if (b.kind === 'suggested_provisions' && (b.items || []).length) {
        warnings.push({ code: 'PROVISIONS_UNVERIFIED', message: 'AI-suggested provisions have not been checked against an authoritative source.' });
      }
    }
  }
  if (factBlocks === 0) blockers.push({ code: 'NO_FACTS', message: 'The brief has no facts in its statement of facts.' });

  // De-duplicate repeated messages for the same fact (fact + chronology).
  const uniq = (list) => list.filter((x, i) => list.findIndex((y) => y.message === x.message) === i);
  return { blockers: uniq(blockers), warnings: uniq(warnings) };
}

export function briefHasReviewerEdits(brief) {
  return Boolean(brief?.content?.last_edited_at);
}
