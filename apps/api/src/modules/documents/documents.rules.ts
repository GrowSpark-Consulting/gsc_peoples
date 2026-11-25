import { DOCUMENT_ALLOWED_MIME_TYPES, DOCUMENT_MAX_BYTES } from '@gsc/contracts';

export const ALLOWED_MIME: ReadonlySet<string> = new Set(DOCUMENT_ALLOWED_MIME_TYPES);
export const MAX_BYTES = DOCUMENT_MAX_BYTES;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Leading bytes each allowed type must have. The declared Content-Type alone is never trusted. */
const SIGNATURES: Record<string, number[][]> = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  [DOCX]: [[0x50, 0x4b, 0x03, 0x04]], // zip container
};

const startsWith = (buf: Buffer, sig: number[]) => buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

export type UploadCheck = { ok: true } | { ok: false; status: 400 | 413; message: string };

/** Server-side validation of an uploaded file: type allow-list, content signature, 1 byte .. 10 MB. */
export function checkUpload(file: { mimeType: string; buffer: Buffer; truncated?: boolean }): UploadCheck {
  if (file.truncated || file.buffer.length > MAX_BYTES) return { ok: false, status: 413, message: 'File exceeds 10 MB' };
  if (file.buffer.length === 0) return { ok: false, status: 400, message: 'The file is empty' };
  if (!ALLOWED_MIME.has(file.mimeType)) return { ok: false, status: 400, message: 'Unsupported file type' };
  const sigs = SIGNATURES[file.mimeType] ?? [];
  if (!sigs.some((s) => startsWith(file.buffer, s))) return { ok: false, status: 400, message: 'The file content does not match its type' };
  // A DOCX is a zip container: require the Word package parts, so any other archive renamed .docx is refused.
  // Zip entry names are stored uncompressed.
  if (file.mimeType === DOCX && !(file.buffer.includes('[Content_Types].xml') && file.buffer.includes('word/'))) {
    return { ok: false, status: 400, message: 'The file content does not match its type' };
  }
  return { ok: true };
}

/** A display name that is safe to store and echo: no path, no control characters, at most 255 characters. */
export function cleanFileName(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255);
  return cleaned || 'document';
}
