import { describe, expect, it } from 'vitest';
import { briefToHtml, briefToMarkdown, escapeHtml, safeFilename } from '@/lib/case-prep/export';
import { factProvenance, formatFactDate, matterSentence } from '@/lib/case-prep/provenance';
import type { Brief, Fact, Issue } from '@/lib/case-prep/types';

const fact = (over: Partial<Fact>): Fact => ({
  id: 'f1', workspace_id: 'w', document_id: 'd', statement: 'The complainant reported theft.', original_statement: null,
  fact_type: 'event', event_date: '2024-08-12', date_text: '12/08/2024', date_precision: 'day', date_flag: null, parties: [],
  verification: 'source_verified', unverified_reason: null, claimed_sources: null, review_status: 'accepted', origin: 'ai', reviewer_note: null,
  citations: [{ id: 'c1', fact_id: 'f1', document_id: 'd', document_name: 'FIR.pdf', passage_id: 'p', passage_label: 'p1.1', page_number: 1, quote: 'reported theft', quote_start: 0, quote_end: 14, match_type: 'exact' }],
  ...over,
});

const facts = [
  fact({}),
  fact({ id: 'f2', statement: 'Injected <script>alert(1)</script> text', citations: [], verification: 'unverified', review_status: 'pending', unverified_reason: 'Quote not found' }),
];
const issues: Issue[] = [{
  id: 'i1', title: 'Theft', analysis: 'Dishonest intention must be shown.', issue_type: 'substantive', fact_ids: ['f1'],
  provisions: [], evidence_gaps: [], counter_arguments: [], sanitation_notes: [], review_status: 'accepted', origin: 'ai', reviewer_note: null,
}];

function brief(status: 'draft' | 'approved'): Brief {
  return {
    id: 'b', workspace_id: 'w', revision: 3, status, approved_by: null, approved_at: null,
    approval_attestation: status === 'approved' ? 'Adv. Rao confirmed review.' : null, updated_at: '',
    content: {
      generated_at: '',
      sections: [
        { id: 'facts', title: 'Statement of facts', blocks: [{ id: 'b1', kind: 'fact', origin: 'source', edited: true, fact_id: 'f1', text: 'Reworded <b>fact</b>' }] },
        { id: 'issues', title: 'Issues', blocks: [{ id: 'b2', kind: 'analysis', origin: 'ai', edited: false, issue_id: 'i1', title: 'Theft', text: 'Dishonest intention must be shown.' }] },
        { id: 'unverified', title: 'Unverified claims', blocks: [{ id: 'b3', kind: 'unverified', origin: 'ai', edited: false, fact_ids: ['f2'] }] },
      ],
    },
  };
}

const workspace = { title: 'State v. <Suresh>', matter_type: 'criminal' as const, forum: null, client_side: null };

describe('brief export', () => {
  it('escapes document-derived text in the printable HTML', () => {
    const html = briefToHtml({ workspace, brief: brief('draft'), facts, issues });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>fact</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('State v. &lt;Suresh&gt;');
  });

  it('watermarks drafts and labels provenance', () => {
    const draft = briefToHtml({ workspace, brief: brief('draft'), facts, issues });
    expect(draft).toContain('DRAFT, NOT APPROVED');
    expect(draft).toContain('Source-verified, reworded by reviewer');
    expect(draft).toContain('AI analysis');
    const approved = briefToHtml({ workspace, brief: brief('approved'), facts, issues });
    expect(approved).not.toContain("content: 'DRAFT");
    expect(approved).toContain('Adv. Rao confirmed review.');
  });

  it('writes Markdown with source footnotes and keeps unverified claims separate', () => {
    const md = briefToMarkdown({ workspace, brief: brief('draft'), facts, issues });
    expect(md).toContain('DRAFT, NOT APPROVED');
    expect(md).toMatch(/- Reworded <b>fact<\/b>\[\^1\]/);
    expect(md).toContain('[^1]: FIR.pdf, page 1 (p1.1): "reported theft"');
    expect(md).toMatch(/## Unverified claims[\s\S]*Injected/);
  });

  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(safeFilename('State v. Suresh / FIR 245')).toBe('State-v-Suresh-FIR-245');
  });
});

describe('provenance labels', () => {
  it('classifies facts', () => {
    expect(factProvenance({ verification: 'source_verified', review_status: 'pending' })).toBe('verified');
    expect(factProvenance({ verification: 'unverified', review_status: 'accepted' })).toBe('confirmed');
    expect(factProvenance({ verification: 'unverified', review_status: 'pending' })).toBe('unverified');
  });

  it('formats dates at the precision the source supports', () => {
    expect(formatFactDate('2024-08-12', 'day')).toBe('12 Aug 2024');
    expect(formatFactDate('2024-08-01', 'month')).toBe('Aug 2024');
    expect(formatFactDate(null, 'unknown')).toBe('Undated');
  });

  it('describes the matter in a sentence', () => {
    expect(matterSentence({ matter_type: 'criminal', forum: 'CJM Jaipur', client_side: 'Complainant' })).toBe('Criminal matter before CJM Jaipur, acting for the complainant.');
  });
});
