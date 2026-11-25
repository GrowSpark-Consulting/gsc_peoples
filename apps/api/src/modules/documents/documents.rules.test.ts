import { describe, expect, it } from 'vitest';
import { MAX_BYTES, checkUpload, cleanFileName } from './documents.rules';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
/** A zip whose entry names are those of a Word package. */
const docx = Buffer.concat([zip, Buffer.from('[Content_Types].xml word/document.xml')]);

describe('checkUpload', () => {
  it('accepts each allowed type with a matching signature', () => {
    for (const [mimeType, buffer] of [['application/pdf', pdf], ['image/png', png], ['image/jpeg', jpg], [DOCX, docx]] as const)
      expect(checkUpload({ mimeType, buffer }), mimeType).toEqual({ ok: true });
  });
  it('rejects an ordinary zip archive renamed to .docx', () => {
    expect(checkUpload({ mimeType: DOCX, buffer: zip })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a disallowed MIME type even with plausible bytes', () => {
    expect(checkUpload({ mimeType: 'text/html', buffer: Buffer.from('<html>') })).toMatchObject({ ok: false, status: 400, message: 'Unsupported file type' });
    expect(checkUpload({ mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ....') })).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects content that does not match the declared type (spoofed Content-Type)', () => {
    expect(checkUpload({ mimeType: 'application/pdf', buffer: Buffer.from('<script>alert(1)</script>') })).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload({ mimeType: 'image/png', buffer: jpg })).toMatchObject({ ok: false, status: 400 });
  });
  it('enforces 1 byte .. 10 MB: empty is 400, over the limit and truncated streams are 413', () => {
    expect(checkUpload({ mimeType: 'application/pdf', buffer: Buffer.alloc(0) })).toMatchObject({ ok: false, status: 400 });
    const exactly = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_BYTES - 5)]);
    expect(exactly.length).toBe(MAX_BYTES);
    expect(checkUpload({ mimeType: 'application/pdf', buffer: exactly })).toEqual({ ok: true });
    expect(checkUpload({ mimeType: 'application/pdf', buffer: Buffer.concat([exactly, Buffer.from('x')]) })).toMatchObject({ ok: false, status: 413 });
    expect(checkUpload({ mimeType: 'application/pdf', buffer: pdf, truncated: true })).toMatchObject({ ok: false, status: 413 });
  });
});

describe('cleanFileName', () => {
  it('drops any path, control characters and quotes, and caps the length', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\x\\cv.pdf')).toBe('cv.pdf');
    expect(cleanFileName('a"b\r\nc.pdf')).toBe('abc.pdf');
    expect(cleanFileName('x'.repeat(400))).toHaveLength(255);
    expect(cleanFileName('')).toBe('document');
    expect(cleanFileName(undefined)).toBe('document');
  });
});
