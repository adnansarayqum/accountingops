import { describe, expect, it } from 'vitest';
import { bytesMatchType, documentFileName, ERROR_MESSAGES, MAX_BATCH_BYTES, MAX_FILE_BYTES, MAX_FILES_PER_BATCH, MAX_TEXT_CHARS, shareMessage, sniffType, validateBatch, validateParts } from '../intake.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const file = (bytes, contentType, fileName = 'x') => ({ fileName, contentType, contentBase64: Buffer.from(bytes).toString('base64') });

describe('bytesMatchType', () => {
  it('checks each readable type by its real signature', () => {
    expect(bytesMatchType(JPEG, 'image/jpeg')).toBe(true);
    expect(bytesMatchType(PNG, 'image/png')).toBe(true);
    expect(bytesMatchType(PDF, 'application/pdf')).toBe(true);
    expect(bytesMatchType(Buffer.from('GIF89a..'), 'image/gif')).toBe(true);
    expect(bytesMatchType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp')).toBe(true);
    expect(bytesMatchType(Buffer.from('Hello, my UTR is 1234567890'), 'text/plain')).toBe(true);
  });

  it('rejects bytes labelled as something they are not, and unknown types', () => {
    expect(bytesMatchType(PDF, 'image/jpeg')).toBe(false);
    expect(bytesMatchType(JPEG, 'application/pdf')).toBe(false);
    expect(bytesMatchType(Buffer.from([0x00, 0x01, 0x02]), 'text/plain')).toBe(false);
    expect(bytesMatchType(JPEG, 'image/heic')).toBe(false);
  });
});

describe('validateBatch', () => {
  it('turns files and shared text into parts, with safe names', () => {
    const { parts } = validateBatch({ files: [file(JPEG, 'image/jpeg', 'IMG_0001.jpeg'), file(PDF, 'application/pdf; charset=binary', '../../statement.pdf')], text: '  my new address is 1 High St  ' });
    expect(parts.map((p) => [p.fileName, p.contentType])).toEqual([
      ['IMG_0001.jpg', 'image/jpeg'],
      ['..-..-statement.pdf', 'application/pdf'],
      ['Shared text.txt', 'text/plain'],
    ]);
    expect(parts[2].bytes.toString('utf8')).toBe('my new address is 1 High St');
  });

  it('accepts text on its own', () => {
    expect(validateBatch({ text: 'UTR 1234567890' }).parts).toHaveLength(1);
  });

  it('names the first problem before anything is stored', () => {
    expect(validateBatch({})).toEqual({ error: 'empty' });
    expect(validateBatch({ files: [], text: '   ' })).toEqual({ error: 'empty' });
    expect(validateBatch({ files: Array.from({ length: MAX_FILES_PER_BATCH + 1 }, () => file(JPEG, 'image/jpeg')) })).toEqual({ error: 'too_many_files' });
    expect(validateBatch({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).toEqual({ error: 'text_too_long' });
    expect(validateBatch({ files: [file(JPEG, 'image/heic')] })).toEqual({ error: 'unsupported_type' });
    expect(validateBatch({ files: [file(JPEG, 'application/x-msdownload')] })).toEqual({ error: 'unsupported_type' });
    expect(validateBatch({ files: [{ fileName: 'a', contentType: 'image/jpeg' }] })).toEqual({ error: 'missing_content' });
    expect(validateBatch({ files: [file(PDF, 'image/jpeg')] })).toEqual({ error: 'content_mismatch' });
  });

  it('caps each file and the batch as a whole', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_FILE_BYTES)]);
    expect(validateBatch({ files: [file(big, 'image/jpeg')] })).toEqual({ error: 'file_too_large' });
    const nine = Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]);
    const count = Math.ceil(MAX_BATCH_BYTES / nine.length) + 1;
    expect(validateBatch({ files: Array.from({ length: Math.min(count, MAX_FILES_PER_BATCH) }, () => file(nine, 'image/jpeg')) })).toEqual({ error: 'batch_too_large' });
  });
});

describe('documentFileName', () => {
  it('names a document by its first page, noting the rest', () => {
    expect(documentFileName([{ fileName: 'a.jpg' }])).toBe('a.jpg');
    expect(documentFileName([{ fileName: 'a.jpg' }, { fileName: 'b.jpg' }])).toBe('a.jpg (+1 more page)');
    expect(documentFileName([{ fileName: 'a.jpg' }, { fileName: 'b.jpg' }, { fileName: 'c.jpg' }])).toBe('a.jpg (+2 more pages)');
  });
});

describe('sniffType', () => {
  it('trusts the bytes over a Shortcut’s loose label', () => {
    expect(sniffType(JPEG, 'application/octet-stream', 'IMG_1.JPG')).toBe('image/jpeg');
    expect(sniffType(PDF, '', 'statement')).toBe('application/pdf');
    expect(sniffType(PNG, 'image/jpeg', 'x.jpg')).toBe('image/png');
  });

  it('calls something text only when it was said to be, and otherwise passes the label on to be refused', () => {
    expect(sniffType(Buffer.from('hello'), 'text/plain; charset=utf-8')).toBe('text/plain');
    expect(sniffType(Buffer.from('hello'), 'application/octet-stream', 'note.txt')).toBe('text/plain');
    expect(sniffType(Buffer.from('hello'), 'application/octet-stream', 'note')).toBe('application/octet-stream');
    expect(sniffType(Buffer.from('....ftypheic'), 'image/heic', 'IMG.HEIC')).toBe('image/heic');
  });
});

describe('validateParts', () => {
  it('applies the same limits as the JSON path to files already decoded', () => {
    expect(validateParts([], '')).toEqual({ error: 'empty' });
    expect(validateParts([{ fileName: 'a', contentType: 'image/heic', bytes: JPEG }])).toEqual({ error: 'unsupported_type' });
    expect(validateParts([{ fileName: 'a', contentType: 'image/jpeg', bytes: Buffer.alloc(0) }])).toEqual({ error: 'missing_content' });
    expect(validateParts([{ fileName: 'a', contentType: 'application/pdf', bytes: JPEG }])).toEqual({ error: 'content_mismatch' });
    const { parts } = validateParts([{ fileName: 'IMG_1.JPG', contentType: 'image/jpeg', bytes: JPEG }], ' note ');
    expect(parts.map((p) => p.fileName)).toEqual(['IMG_1.jpg', 'Shared text.txt']);
  });
});

describe('shareMessage', () => {
  const doc = (overrides) => ({ filed: false, clientName: null, documentType: 'Bank statement', ...overrides });

  it('says where each document went, one line each', () => {
    expect(shareMessage({ read: true, documents: [doc({ filed: true, clientName: 'Acme Ltd' }), doc({ clientName: 'Khan Consulting', documentType: 'VAT notice' }), doc({ documentType: 'Other' })] })).toBe(
      'Filed under Acme Ltd: Bank statement\nVAT notice: best guess Khan Consulting — confirm in Smart Inbox\nOther: choose a client in Smart Inbox',
    );
  });

  it('says so when nothing was read, or the share was a repeat', () => {
    expect(shareMessage({ read: false, documents: [doc(), doc()] })).toBe('Saved 2 documents. Not read automatically — sort them in Smart Inbox.');
    expect(shareMessage({ read: false, documents: [doc()] })).toBe('Saved 1 document. Not read automatically — sort it in Smart Inbox.');
    expect(shareMessage({ duplicate: true })).toBe(ERROR_MESSAGES.already_shared);
  });
});
