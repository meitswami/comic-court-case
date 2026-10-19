import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptBuffer, encryptBuffer, parseKey, readFile, saveFile, storageDir, storageStatus } from '../../server/lib/case-prep/storage.js';
import { ExtractionError, extractDocument, sniffFile } from '../../server/lib/case-prep/extract.js';
import { parseJsonObject, resolveAIConfig } from '../../server/lib/ai-provider.js';
import { FIR_PAGES, TINY_PNG, makePdf, makeScannedPdf } from '../helpers/fixtures.js';

describe('storage', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.CASE_PREP_ENCRYPTION_KEY = originalEnv.CASE_PREP_ENCRYPTION_KEY;
  });

  it('round-trips AES-256-GCM and detects tampering', () => {
    const key = crypto.randomBytes(32);
    const plain = Buffer.from('confidential FIR text');
    const sealed = encryptBuffer(plain, key);
    expect(sealed.includes(plain)).toBe(false);
    expect(decryptBuffer(sealed, key).equals(plain)).toBe(true);
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => decryptBuffer(sealed, key)).toThrow();
  });

  it('stores files encrypted at rest outside public/', async () => {
    const plain = Buffer.from('%PDF-1.4 secret');
    const { storageKey, encrypted } = await saveFile(plain);
    expect(encrypted).toBe(true);
    expect(storageDir()).not.toMatch(/public/);
    const onDisk = await fs.readFile(path.join(storageDir(), storageKey.slice(0, 2), storageKey));
    expect(onDisk.includes(Buffer.from('secret'))).toBe(false);
    expect((await readFile(storageKey, true)).equals(plain)).toBe(true);
  });

  it('refuses plaintext storage in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CASE_PREP_ENCRYPTION_KEY = '';
    expect(storageStatus()).toMatchObject({ ready: false, encrypted: false });
  });

  it('rejects malformed keys', () => {
    expect(() => parseKey('too-short')).toThrow(/32 bytes/);
    expect(parseKey('a'.repeat(64))).toHaveLength(32);
  });
});

describe('sniffFile', () => {
  it('identifies files by signature, not name', () => {
    expect(sniffFile(makePdf([['hello world']]), 'x.txt').kind).toBe('pdf');
    expect(sniffFile(TINY_PNG, 'photo.pdf')).toEqual({ kind: 'image', mime: 'image/png' });
    expect(sniffFile(Buffer.from('plain words'), 'notes.txt').kind).toBe('text');
  });

  it('rejects executables, Office files, binary text and empty files', () => {
    expect(() => sniffFile(Buffer.from('MZ\x90\x00binary'), 'fir.pdf')).toThrow(ExtractionError);
    expect(() => sniffFile(Buffer.from('PK\x03\x04docx'), 'brief.docx')).toThrow(/Save the document as PDF/);
    expect(() => sniffFile(Buffer.from([0x41, 0x00, 0x42]), 'a.txt')).toThrow(ExtractionError);
    expect(() => sniffFile(Buffer.alloc(0), 'a.txt')).toThrow(/empty/);
  });
});

describe('extractDocument', () => {
  it('extracts page-anchored passages from a PDF', async () => {
    const result = await extractDocument(makePdf(FIR_PAGES), 'pdf');
    expect(result).toMatchObject({ status: 'extracted', method: 'pdf_text', pageCount: 2 });
    const pages = [...new Set(result.passages.map((p) => p.page_number))];
    expect(pages).toEqual([1, 2]);
    expect(result.passages.find((p) => p.page_number === 1).content).toContain('Ramesh Kumar reported theft');
    expect(result.passages.find((p) => p.page_number === 2).content).toContain('Anita Devi');
  });

  it('marks PDFs without a text layer as needing OCR', async () => {
    const result = await extractDocument(makeScannedPdf(), 'pdf');
    expect(result).toMatchObject({ status: 'needs_ocr', passages: [] });
  });

  it('treats form feeds in text files as page breaks', async () => {
    const result = await extractDocument(Buffer.from('Page one text here.\fPage two text here.'), 'text');
    expect(result.passages.map((p) => p.label)).toEqual(['p1.1', 'p2.1']);
  });

  it('rejects damaged PDFs with a clear message', async () => {
    await expect(extractDocument(Buffer.from('%PDF-1.4 garbage'), 'pdf')).rejects.toThrow(/could not be read/);
  });
});

describe('AI provider configuration', () => {
  it('requires HTTPS for remote providers but allows local Ollama over HTTP', () => {
    expect(resolveAIConfig({ AI_API_BASE_URL: 'http://ai.example.com/v1', AI_MODEL: 'm' }).error).toMatch(/HTTPS/);
    expect(resolveAIConfig({ OLLAMA_ENDPOINT: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'llama3.1' })).toMatchObject({
      error: null, baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', vision: false,
    });
  });

  it('keeps the existing gateway configuration working', () => {
    expect(resolveAIConfig({ LOVABLE_API_KEY: 'k' })).toMatchObject({
      error: null, baseUrl: 'https://ai.gateway.lovable.dev/v1', apiKey: 'k', model: 'google/gemini-2.5-flash', vision: true,
    });
  });

  it('reports missing configuration instead of guessing', () => {
    expect(resolveAIConfig({}).error).toMatch(/No AI provider/);
  });

  it('parses JSON wrapped in prose or code fences, and rejects non-JSON', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => parseJsonObject('no json here')).toThrow(/not valid JSON/);
  });
});
