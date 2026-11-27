import type { Request } from 'express';
import busboy from 'busboy';
import { AppError, ValidationError } from '../../shared/errors';
import { MAX_BYTES } from './documents.rules';

export interface ParsedUpload {
  fields: Record<string, string>;
  file: { buffer: Buffer; fileName: string; mimeType: string; truncated: boolean } | null;
}

/** Part of the request that is not file bytes (field names/values and part headers). */
const OVERHEAD_BYTES = 64 * 1024;

/**
 * Reads one multipart/form-data upload into memory: exactly one `file` part of at most MAX_BYTES plus a few
 * short text fields. Everything above those limits is refused, not buffered:
 *  - Content-Length above MAX_BYTES + overhead is rejected before any byte is read (413);
 *  - the file stream is cut off at MAX_BYTES + 1 and flagged `truncated` (the route answers 413);
 *  - more than one file, more than 10 fields, or oversized field values are a 400.
 */
export function readUpload(req: Request): Promise<ParsedUpload> {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return Promise.reject(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the upload as multipart/form-data'));
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BYTES + OVERHEAD_BYTES) {
    return Promise.reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds 10 MB'));
  }

  return new Promise<ParsedUpload>((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES + 1, fields: 10, fieldSize: 2048, parts: 12 }, defParamCharset: 'utf8' });
    } catch {
      return reject(new ValidationError('Malformed multipart request'));
    }
    const fields: Record<string, string> = {};
    let file: ParsedUpload['file'] = null;
    let failed: Error | null = null;
    const fail = (e: Error) => {
      failed ??= e;
    };

    bb.on('field', (name, value, info) => {
      if (info.valueTruncated) return fail(new ValidationError(`Field "${name}" is too long`));
      if (name in fields) return fail(new ValidationError(`Field "${name}" was sent twice`));
      fields[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      let truncated = false;
      if (name !== 'file') fail(new ValidationError('The file part must be named "file"'));
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('close', () => {
        file = { buffer: Buffer.concat(chunks), fileName: info.filename, mimeType: info.mimeType.toLowerCase(), truncated };
      });
    });
    bb.on('filesLimit', () => fail(new ValidationError('Upload exactly one file')));
    bb.on('fieldsLimit', () => fail(new ValidationError('Too many fields')));
    bb.on('partsLimit', () => fail(new ValidationError('Too many parts')));
    bb.on('error', () => reject(new ValidationError('Malformed multipart request')));
    bb.on('close', () => (failed ? reject(failed) : resolve({ fields, file })));
    req.pipe(bb);
  });
}

export interface ParsedMultiUpload {
  fields: Record<string, string>;
  files: Record<string, { buffer: Buffer; fileName: string; mimeType: string; truncated: boolean }>;
}

/**
 * Like `readUpload`, for forms with several NAMED file parts (e.g. `front` and `back`), each at most `maxBytes`.
 * Unknown part names, a repeated part, more parts than allowed or a body larger than all parts together are
 * refused without buffering the excess.
 */
export function readMultiUpload(req: Request, opts: { fileFields: readonly string[]; maxBytes: number; maxFields: number; sizeLabel: string }): Promise<ParsedMultiUpload> {
  const contentType = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return Promise.reject(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the upload as multipart/form-data'));
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > opts.maxBytes * opts.fileFields.length + OVERHEAD_BYTES) {
    return Promise.reject(new AppError(413, 'PAYLOAD_TOO_LARGE', `Each file can be at most ${opts.sizeLabel}`));
  }

  return new Promise<ParsedMultiUpload>((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { files: opts.fileFields.length, fileSize: opts.maxBytes + 1, fields: opts.maxFields, fieldSize: 2048, parts: opts.fileFields.length + opts.maxFields + 1 },
        defParamCharset: 'utf8',
      });
    } catch {
      return reject(new ValidationError('Malformed multipart request'));
    }
    const fields: Record<string, string> = {};
    const files: ParsedMultiUpload['files'] = {};
    const seen = new Set<string>();
    let failed: Error | null = null;
    const fail = (e: Error) => {
      failed ??= e;
    };

    bb.on('field', (name, value, info) => {
      if (info.valueTruncated) return fail(new ValidationError(`Field "${name}" is too long`));
      if (name in fields) return fail(new ValidationError(`Field "${name}" was sent twice`));
      fields[name] = value;
    });
    bb.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      let truncated = false;
      if (!opts.fileFields.includes(name)) fail(new ValidationError(`Unexpected file part "${name.slice(0, 32)}"`));
      else if (seen.has(name)) fail(new ValidationError(`File part "${name}" was sent twice`));
      seen.add(name);
      stream.on('data', (c: Buffer) => {
        if (!failed) chunks.push(c);
      });
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('close', () => {
        if (opts.fileFields.includes(name) && !(name in files)) files[name] = { buffer: Buffer.concat(chunks), fileName: info.filename ?? '', mimeType: (info.mimeType ?? '').toLowerCase(), truncated };
      });
    });
    bb.on('filesLimit', () => fail(new ValidationError('Too many files')));
    bb.on('fieldsLimit', () => fail(new ValidationError('Too many fields')));
    bb.on('partsLimit', () => fail(new ValidationError('Too many parts')));
    bb.on('error', () => reject(new ValidationError('Malformed multipart request')));
    bb.on('close', () => (failed ? reject(failed) : resolve({ fields, files })));
    req.pipe(bb);
  });
}
