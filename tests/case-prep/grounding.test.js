import { describe, expect, it } from 'vitest';
import { buildFactRefs, groundFacts, groundIssues } from '../../server/lib/case-prep/analysis.js';
import { applyBriefEdits, approvalBlockers, buildBrief, BriefValidationError } from '../../server/lib/case-prep/brief.js';

const passages = [
  { id: 'pa', label: 'p1.1', page_number: 1, content: 'On 12/08/2024 at about 9 PM the complainant Ramesh Kumar reported theft of his motorcycle.' },
  { id: 'pb', label: 'p2.1', page_number: 2, content: 'The accused Suresh Sharma was seen near the parking area by witness Anita Devi.' },
];

describe('groundFacts', () => {
  const proposed = [
    { statement: 'Ramesh Kumar reported theft of his motorcycle.', fact_type: 'event', date_text: '12/08/2024', date_iso: '2024-12-08',
      citations: [{ passage: 'p1.1', quote: 'the complainant Ramesh Kumar reported theft of his motorcycle' }] },
    { statement: 'Anita Devi saw Suresh Sharma near the parking area.', fact_type: 'event',
      citations: [{ passage: 'p1.1', quote: 'seen near the parking area by witness Anita Devi' }] },
    { statement: 'The accused confessed to the theft.', fact_type: 'admission',
      citations: [{ passage: 'p2.1', quote: 'the accused confessed to stealing the motorcycle' }] },
    { statement: 'Ramesh Kumar reported theft of his motorcycle.', citations: [] },
    { statement: 'An uncited claim about bail.', fact_type: 'not-a-type' },
    { statement: '' },
  ];
  const facts = groundFacts({ proposed, passages, documentId: 'doc', workspaceId: 'ws' });

  it('keeps only verified quotes as citations, with exact source text', () => {
    expect(facts[0].verification).toBe('source_verified');
    expect(facts[0].citations[0]).toMatchObject({ passage_id: 'pa', page_number: 1, quote: 'the complainant Ramesh Kumar reported theft of his motorcycle' });
  });

  it('re-links a real quote to the passage that contains it', () => {
    expect(facts[1].citations[0].passage_id).toBe('pb');
    expect(facts[1].citations[0].page_number).toBe(2);
  });

  it('marks fabricated or uncited statements as unverified and records what the AI claimed', () => {
    expect(facts[2]).toMatchObject({ verification: 'unverified', citations: [] });
    expect(facts[2].claimed_sources[0].quote).toMatch(/confessed/);
    expect(facts[3]).toMatchObject({ verification: 'unverified', fact_type: 'other' });
  });

  it('drops duplicates and empty statements, and fixes the date from the source', () => {
    expect(facts).toHaveLength(4);
    expect(facts[0]).toMatchObject({ event_date: '2024-08-12', date_precision: 'day' });
    expect(facts[0].date_flag).toMatch(/2024-12-08/);
  });
});

describe('groundIssues', () => {
  const facts = [
    { id: 'f1', statement: 'A', review_status: 'pending', verification: 'source_verified' },
    { id: 'f2', statement: 'B', review_status: 'rejected', verification: 'source_verified' },
    { id: 'f3', statement: 'C', review_status: 'accepted', verification: 'unverified' },
  ];
  const refs = buildFactRefs(facts);

  it('numbers only non-rejected facts', () => {
    expect(refs.map((r) => [r.ref, r.fact.id])).toEqual([['F1', 'f1'], ['F2', 'f3']]);
  });

  it('maps references to fact ids, drops unknown ones and sanitises prose', () => {
    const [issue] = groundIssues({
      factRefs: refs,
      proposed: [{
        title: 'Whether theft is made out', issue_type: 'substantive',
        analysis: 'Dishonest intention must be shown; see (2014) 8 SCC 273 and https://example.com.',
        fact_refs: ['F1', 'f2', 'F9'],
        provisions: [{ act: 'IPC', section: '379', relevance: 'theft' }, { act: 'Imaginary Act', section: '' }],
        evidence_gaps: ['Ownership papers of the motorcycle'],
      }],
    });
    expect(issue.fact_ids).toEqual(['f1', 'f3']);
    expect(issue.analysis).not.toMatch(/SCC|https/);
    expect(issue.sanitation_notes.length).toBeGreaterThan(0);
    expect(issue.provisions).toHaveLength(1);
    expect(issue.provisions[0]).toMatchObject({ act_key: 'IPC', authority_status: 'unverified' });
  });

  it('notes when an issue is not linked to any fact', () => {
    const [issue] = groundIssues({ factRefs: refs, proposed: [{ title: 'Limitation', fact_refs: [] }] });
    expect(issue.fact_ids).toEqual([]);
    expect(issue.sanitation_notes.join(' ')).toMatch(/not link/);
  });
});

describe('brief', () => {
  const workspace = { title: 'State v. Suresh', matter_type: 'criminal', forum: 'CJM Jaipur', client_side: 'Complainant' };
  const facts = [
    { id: 'f1', statement: 'Verified pending', verification: 'source_verified', review_status: 'pending', event_date: '2024-08-12' },
    { id: 'f2', statement: 'Unverified pending', verification: 'unverified', review_status: 'pending' },
    { id: 'f3', statement: 'Unverified but confirmed', verification: 'unverified', review_status: 'accepted' },
    { id: 'f4', statement: 'Rejected', verification: 'source_verified', review_status: 'rejected' },
  ];
  const issues = [{ id: 'i1', title: 'Theft', analysis: 'Analysis', review_status: 'pending', provisions: [], evidence_gaps: ['Gap'] }];
  const content = buildBrief({ workspace, documents: [], facts, issues });
  const section = (id) => content.sections.find((s) => s.id === id);

  it('puts only verified or reviewer-confirmed facts into the statement of facts', () => {
    expect(section('facts').blocks.map((b) => [b.fact_id, b.origin])).toEqual([['f1', 'source'], ['f3', 'reviewer_confirmed']]);
    expect(section('unverified').blocks[0].fact_ids).toEqual(['f2']);
    expect(section('chronology').blocks[0].fact_ids).toEqual(['f1']);
  });

  it('blocks approval until facts and analysis are reviewed', () => {
    const { blockers } = approvalBlockers(content, facts, issues);
    expect(blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['FACT_NOT_REVIEWED', 'ISSUE_NOT_REVIEWED']));
    const reviewed = approvalBlockers(content, facts.map((f) => ({ ...f, review_status: f.review_status === 'pending' ? 'accepted' : f.review_status })), issues.map((i) => ({ ...i, review_status: 'accepted' })));
    expect(reviewed.blockers).toEqual([]);
    expect(reviewed.warnings.map((w) => w.code)).toContain('FACT_NO_SOURCE');
  });

  it('lets reviewers edit text but never provenance', () => {
    const facts1 = section('facts').blocks[0];
    const edited = applyBriefEdits(content, {
      sections: [{
        id: 'facts',
        blocks: [
          { ...facts1, text: 'Reworded fact', kind: 'note', origin: 'reviewer', fact_id: 'someone-elses-fact' },
          { id: 'note-12345678', kind: 'note', text: 'My note' },
        ],
      }],
    });
    const [factBlock, note] = edited.sections.find((s) => s.id === 'facts').blocks;
    expect(factBlock).toMatchObject({ kind: 'fact', origin: 'source', fact_id: 'f1', text: 'Reworded fact', edited: true });
    expect(note).toMatchObject({ kind: 'note', origin: 'reviewer', text: 'My note' });
    expect(edited.last_edited_at).toBeTruthy();
  });

  it('refuses client-created non-note blocks and unknown sections', () => {
    expect(() => applyBriefEdits(content, { sections: [{ id: 'facts', blocks: [{ id: 'forged-1234567', kind: 'fact', fact_id: 'f4', text: 'x' }] }] }))
      .toThrow(BriefValidationError);
    expect(() => applyBriefEdits(content, { sections: [{ id: 'nope', blocks: [] }] })).toThrow(BriefValidationError);
  });
});
