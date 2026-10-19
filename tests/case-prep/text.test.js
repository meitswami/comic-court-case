import { describe, expect, it } from 'vitest';
import { batchPassages, chunkPage, cleanPageText, findQuote, normalizeForMatch, verifyCitation } from '../../server/lib/case-prep/text.js';

describe('chunkPage', () => {
  it('produces passages whose offsets point back to the exact page text', () => {
    const page = cleanPageText(`Para one line one.\nPara one line two.\n\nPara two is here.\n\n${'Long sentence here. '.repeat(120)}`);
    const passages = chunkPage(page, 3);
    expect(passages.length).toBeGreaterThan(1);
    passages.forEach((p, i) => {
      expect(p.label).toBe(`p3.${i + 1}`);
      expect(p.page_number).toBe(3);
      expect(page.slice(p.char_start, p.char_end)).toBe(p.content);
      expect(p.content.length).toBeLessThanOrEqual(1400);
    });
  });

  it('returns nothing for an empty page', () => {
    expect(chunkPage('', 1)).toEqual([]);
  });
});

describe('findQuote', () => {
  const content = 'On 12/08/2024 the complainant “Ramesh Kumar” reported   theft of his motorcycle — near the market.';

  it('finds exact quotes', () => {
    const hit = findQuote(content, 'reported   theft of his motorcycle');
    expect(hit.matchType).toBe('exact');
    expect(content.slice(hit.start, hit.end)).toBe('reported   theft of his motorcycle');
  });

  it('matches across quote style, dash, whitespace and case differences, mapping back to the source', () => {
    const hit = findQuote(content, 'the complainant "ramesh kumar" reported theft of his motorcycle - near');
    expect(hit.matchType).toBe('normalized');
    expect(content.slice(hit.start, hit.end)).toBe('the complainant “Ramesh Kumar” reported   theft of his motorcycle — near');
  });

  it('accepts ellipsis-joined quotes only when every segment is present in order', () => {
    expect(findQuote(content, 'the complainant “Ramesh Kumar” ... motorcycle — near the market').matchType).toBe('segmented');
    expect(findQuote(content, 'near the market ... the complainant “Ramesh Kumar”')).toBeNull();
  });

  it('rejects fabricated or trivially short quotes', () => {
    expect(findQuote(content, 'the accused confessed to the theft')).toBeNull();
    expect(findQuote(content, 'the')).toBeNull();
  });

  it('treats Devanagari and ASCII digits as equal', () => {
    expect(findQuote('दिनांक १२/०८/२०२४ को घटना हुई', 'दिनांक 12/08/2024 को')).not.toBeNull();
  });
});

describe('verifyCitation', () => {
  const passages = [
    { id: 'a', label: 'p1.1', page_number: 1, content: 'The complainant Ramesh Kumar reported theft of his motorcycle.' },
    { id: 'b', label: 'p2.1', page_number: 2, content: 'The accused Suresh Sharma was seen near the parking area by witness Anita Devi.' },
  ];

  it('verifies a quote in the claimed passage', () => {
    const r = verifyCitation(passages, { passage: 'p1.1', quote: 'Ramesh Kumar reported theft' });
    expect(r.verified).toBe(true);
    expect(r.passage.id).toBe('a');
    expect(r.relinked).toBe(false);
  });

  it('re-links a real quote that the model attributed to the wrong passage', () => {
    const r = verifyCitation(passages, { passage: 'p1.1', quote: 'seen near the parking area by witness Anita Devi' });
    expect(r.verified).toBe(true);
    expect(r.passage.id).toBe('b');
    expect(r.relinked).toBe(true);
  });

  it('does not verify a quote that is not in the document', () => {
    const r = verifyCitation(passages, { passage: 'p2.1', quote: 'the accused confessed to stealing the motorcycle' });
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it('does not verify a citation with no quote', () => {
    expect(verifyCitation(passages, { passage: 'p1.1' }).verified).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizes invisible characters away', () => {
    expect(normalizeForMatch('Ra­mesh​  Kumar')).toBe('ramesh kumar');
  });

  it('batches passages within a character budget', () => {
    const passages = Array.from({ length: 10 }, (_, i) => ({ label: `p1.${i}`, content: 'x'.repeat(1000) }));
    const batches = batchPassages(passages, 3000);
    expect(batches.length).toBeGreaterThan(3);
    expect(batches.flat()).toHaveLength(10);
  });
});
