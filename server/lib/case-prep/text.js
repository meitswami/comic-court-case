// Text utilities for the case-preparation workspace.
//
// Two jobs:
//  1. Split extracted page text into small, labelled passages (p<page>.<n>)
//     with character offsets, so every citation points at a precise spot.
//  2. Verify that a quote the model claims to have copied really exists in
//     the stored source text. Only verified quotes become citations.

const PASSAGE_TARGET_CHARS = 900;
const PASSAGE_MAX_CHARS = 1400;
export const MIN_QUOTE_CHARS = 8;

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

// Characters that commonly differ between a model's copy and the source.
const CHAR_FOLDS = new Map([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['′', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['″', '"'],
  ['‐', '-'], ['‑', '-'], ['‒', '-'], ['–', '-'], ['—', '-'], ['−', '-'],
  [' ', ' '], [' ', ' '], [' ', ' '],
]);
const INVISIBLE = new Set(['­', '​', '‌', '‍', '﻿']);

/**
 * Normalise a string for matching and return, for every character of the
 * normalised output, the index of the source character it came from.
 * Folding is per character, so offsets map back exactly.
 */
export function normalizeWithMap(input) {
  const source = String(input ?? '');
  let out = '';
  const map = [];
  let lastWasSpace = true; // trims leading whitespace

  for (let i = 0; i < source.length; i++) {
    let ch = source[i];
    if (INVISIBLE.has(ch)) continue;
    if (CHAR_FOLDS.has(ch)) ch = CHAR_FOLDS.get(ch);
    const devIndex = DEVANAGARI_DIGITS.indexOf(ch);
    if (devIndex !== -1) ch = String(devIndex);

    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out += ' ';
      map.push(i);
      lastWasSpace = true;
      continue;
    }

    // NFKC can expand one char (e.g. ligatures); every output char maps to i.
    const folded = ch.normalize('NFKC').toLowerCase();
    for (const f of folded) {
      out += f;
      map.push(i);
    }
    lastWasSpace = false;
  }

  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

export function normalizeForMatch(input) {
  return normalizeWithMap(input).text;
}

/**
 * Find `quote` inside `content`.
 * Returns { start, end, matchType } (offsets into `content`) or null.
 *  - exact:      byte-for-byte substring
 *  - normalized: equal after folding quotes/dashes/whitespace/case/digits
 *  - segmented:  quote uses an ellipsis; every segment is found, in order
 */
export function findQuote(content, quote) {
  if (typeof content !== 'string' || typeof quote !== 'string') return null;
  const trimmed = quote.trim();
  if (normalizeForMatch(trimmed).length < MIN_QUOTE_CHARS) return null;

  const exact = content.indexOf(trimmed);
  if (exact !== -1) return { start: exact, end: exact + trimmed.length, matchType: 'exact' };

  const hay = normalizeWithMap(content);

  const segments = trimmed
    .split(/\.{3,}|…/)
    .map((s) => normalizeForMatch(s))
    .filter((s) => s.length > 0);

  if (segments.length === 1) {
    const idx = hay.text.indexOf(segments[0]);
    if (idx === -1) return null;
    return {
      start: hay.map[idx],
      end: hay.map[idx + segments[0].length - 1] + 1,
      matchType: 'normalized',
    };
  }

  // Ellipsis-joined quote: every meaningful segment must appear in order.
  if (segments.some((s) => s.length < MIN_QUOTE_CHARS)) return null;
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const seg of segments) {
    const idx = hay.text.indexOf(seg, cursor);
    if (idx === -1) return null;
    if (first === -1) first = idx;
    lastEnd = idx + seg.length;
    cursor = lastEnd;
  }
  return { start: hay.map[first], end: hay.map[lastEnd - 1] + 1, matchType: 'segmented' };
}

/**
 * Verify a model-claimed citation against the passages of ONE document.
 * Tries the claimed passage first; if the quote is elsewhere in the same
 * document the citation is re-linked to the passage that actually contains it.
 *
 * @param {Array<{id,label,page_number,content}>} passages
 * @param {{passage?: string, quote?: string}} claim
 */
export function verifyCitation(passages, claim) {
  const quote = typeof claim?.quote === 'string' ? claim.quote : '';
  const label = typeof claim?.passage === 'string' ? claim.passage.trim().toLowerCase() : '';
  if (!quote.trim()) return { verified: false, reason: 'No quote supplied' };
  if (normalizeForMatch(quote).length < MIN_QUOTE_CHARS) {
    return { verified: false, reason: 'Quote too short to verify' };
  }

  const claimed = passages.find((p) => p.label.toLowerCase() === label);
  const ordered = claimed ? [claimed, ...passages.filter((p) => p !== claimed)] : passages;

  for (const passage of ordered) {
    const hit = findQuote(passage.content, quote);
    if (hit) {
      return {
        verified: true,
        passage,
        start: hit.start,
        end: hit.end,
        quote: passage.content.slice(hit.start, hit.end),
        matchType: hit.matchType,
        relinked: passage !== claimed,
      };
    }
  }
  return {
    verified: false,
    reason: claimed ? 'Quote not found in the cited passage or document' : 'Cited passage does not exist and quote not found',
  };
}

/**
 * Build page text from pdf.js text items, preserving line breaks.
 */
export function pageTextFromPdfItems(items) {
  let text = '';
  let lastY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) {
      text += '\n';
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (y !== null) lastY = y;
  }
  return text;
}

/**
 * Clean page text without changing words: unify line endings, strip control
 * characters, trim trailing spaces. The result is what gets stored and cited.
 */
export function stripControlChars(text, keep = '\n\t') {
  let out = '';
  for (const ch of String(text ?? '')) {
    const code = ch.charCodeAt(0);
    if ((code < 32 || code === 127) && !keep.includes(ch)) continue;
    out += ch;
  }
  return out;
}

export function cleanPageText(raw) {
  return stripControlChars(String(raw ?? '').replace(/\r\n?/g, '\n'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLongSegment(segment, offset) {
  // Split on sentence boundaries, falling back to hard cuts.
  const pieces = [];
  let start = 0;
  while (start < segment.length) {
    let end = Math.min(start + PASSAGE_TARGET_CHARS, segment.length);
    if (end < segment.length) {
      const window = segment.slice(start, Math.min(start + PASSAGE_MAX_CHARS, segment.length));
      const boundary = Math.max(
        window.lastIndexOf('. ', PASSAGE_TARGET_CHARS + 200),
        window.lastIndexOf('। ', PASSAGE_TARGET_CHARS + 200),
        window.lastIndexOf('\n', PASSAGE_TARGET_CHARS + 200)
      );
      end = boundary > 200 ? start + boundary + 1 : Math.min(start + PASSAGE_MAX_CHARS, segment.length);
    }
    pieces.push({ text: segment.slice(start, end), start: offset + start });
    start = end;
  }
  return pieces;
}

/**
 * Split cleaned page text into passages with offsets into that page text.
 * Paragraphs are kept together where possible.
 */
export function chunkPage(pageText, pageNumber) {
  const passages = [];
  if (!pageText) return passages;

  // Paragraph candidates separated by blank lines.
  const paragraphs = [];
  const re = /\n\s*\n/g;
  let last = 0;
  let m;
  while ((m = re.exec(pageText)) !== null) {
    paragraphs.push({ text: pageText.slice(last, m.index), start: last });
    last = m.index + m[0].length;
  }
  paragraphs.push({ text: pageText.slice(last), start: last });

  let buffer = null;
  const flush = () => {
    if (buffer && buffer.text.trim()) passages.push(buffer);
    buffer = null;
  };

  for (const para of paragraphs) {
    if (!para.text.trim()) continue;
    const pieces = para.text.length > PASSAGE_MAX_CHARS ? splitLongSegment(para.text, para.start) : [para];
    for (const piece of pieces) {
      if (buffer && buffer.text.length + piece.text.length + 2 <= PASSAGE_TARGET_CHARS) {
        buffer = { text: pageText.slice(buffer.start, piece.start + piece.text.length), start: buffer.start };
      } else {
        flush();
        buffer = { text: piece.text, start: piece.start };
      }
    }
  }
  flush();

  return passages.map((p, i) => {
    const leading = p.text.length - p.text.trimStart().length;
    const content = p.text.trim();
    const charStart = p.start + leading;
    return {
      label: `p${pageNumber}.${i + 1}`,
      page_number: pageNumber,
      passage_index: i + 1,
      content,
      char_start: charStart,
      char_end: charStart + content.length,
    };
  });
}

/** Group passages into batches that fit a model context budget. */
export function batchPassages(passages, maxChars = 24000) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const p of passages) {
    const len = p.content.length + 40;
    if (current.length && size + len > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += len;
  }
  if (current.length) batches.push(current);
  return batches;
}
