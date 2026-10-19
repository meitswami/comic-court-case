// File validation and text extraction for uploaded case documents.
// Uploaded files are untrusted: the declared MIME type and file name are
// ignored in favour of the file's own signature (magic bytes).

import path from 'path';
import { createRequire } from 'module';
import { chunkPage, cleanPageText, pageTextFromPdfItems } from './text.js';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const MAX_TEXT_CHARS = 1_500_000;
const MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER = 25;

export class ExtractionError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const require = createRequire(import.meta.url);
let standardFontDataUrl;
try {
  standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
} catch {
  standardFontDataUrl = undefined;
}

function isValidUtf8Text(buffer) {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Identify a file by its signature. Returns { kind, mime } or throws.
 * kind: 'pdf' | 'image' | 'text'
 */
export function sniffFile(buffer, originalName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ExtractionError('EMPTY_FILE', 'The file is empty.', 400);
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw new ExtractionError('FILE_TOO_LARGE', `Files must be ${MAX_FILE_BYTES / (1024 * 1024)} MB or smaller.`, 413);
  }
  const head = buffer.subarray(0, 1024);
  if (head.indexOf('%PDF-') !== -1) return { kind: 'pdf', mime: 'application/pdf' };
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', mime: 'image/png' };
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image', mime: 'image/jpeg' };
  }
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'image', mime: 'image/webp' };
  }
  const ext = path.extname(originalName).toLowerCase();
  if (['.txt', '.md', '.text'].includes(ext) && isValidUtf8Text(buffer)) {
    return { kind: 'text', mime: 'text/plain' };
  }
  if (head.subarray(0, 2).toString('latin1') === 'PK') {
    throw new ExtractionError('UNSUPPORTED_TYPE', 'Word and other Office files are not supported yet. Save the document as PDF and upload that.', 415);
  }
  throw new ExtractionError('UNSUPPORTED_TYPE', 'Unsupported file type. Upload a PDF, a PNG/JPEG/WebP image, or a UTF-8 .txt file.', 415);
}

/** Turn an array of page strings into stored passages. */
export function pagesToPassages(pageTexts) {
  const passages = [];
  pageTexts.forEach((raw, i) => {
    passages.push(...chunkPage(cleanPageText(raw), i + 1));
  });
  return passages;
}

async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl,
      verbosity: 0,
    }).promise;
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw new ExtractionError('PDF_PROTECTED', 'This PDF is password-protected. Remove the password and upload it again.');
    }
    throw new ExtractionError('PDF_UNREADABLE', 'This PDF could not be read. It may be damaged.');
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError('PDF_TOO_LONG', `PDFs are limited to ${MAX_PDF_PAGES} pages. Split the document and upload the parts.`);
    }
    const pages = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = pageTextFromPdfItems(content.items);
      total += text.length;
      if (total > MAX_TEXT_CHARS) {
        throw new ExtractionError('TEXT_TOO_LONG', 'This document contains more text than one upload can hold. Split it and upload the parts.');
      }
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Extract page-anchored passages from a validated file.
 * Images return status 'needs_ocr' (OCR runs during analysis, if the model
 * supports images). PDFs without a usable text layer also need OCR.
 */
export async function extractDocument(buffer, kind) {
  if (kind === 'image') {
    return { status: 'needs_ocr', method: null, pageCount: 1, passages: [], charCount: 0 };
  }

  if (kind === 'text') {
    const text = new TextDecoder('utf-8').decode(buffer);
    if (text.length > MAX_TEXT_CHARS) {
      throw new ExtractionError('TEXT_TOO_LONG', 'This text file is too long for one upload. Split it and upload the parts.');
    }
    // Form feeds mark page breaks in exported text; otherwise one page.
    const pages = text.split('\f');
    const passages = pagesToPassages(pages);
    if (!passages.length) throw new ExtractionError('NO_TEXT', 'The text file is empty.');
    return { status: 'extracted', method: 'plain_text', pageCount: pages.length, passages, charCount: text.length };
  }

  const pages = await extractPdf(buffer);
  const passages = pagesToPassages(pages);
  const charCount = passages.reduce((n, p) => n + p.content.length, 0);
  if (charCount < MIN_CHARS_PER_PAGE_FOR_TEXT_LAYER * Math.max(1, pages.length)) {
    return {
      status: 'needs_ocr',
      method: null,
      pageCount: pages.length,
      passages: [],
      charCount: 0,
      note: 'No usable text layer: this looks like a scanned PDF.',
    };
  }
  return { status: 'extracted', method: 'pdf_text', pageCount: pages.length, passages, charCount };
}
