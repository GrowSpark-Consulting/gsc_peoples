import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageError, type DocumentStorage, type PutObjectInput, type SignedUrlOptions } from './types';

/** Route (under /api/v1/documents) that serves local-driver links. Development and tests only. */
export const LOCAL_FILE_ROUTE = '/local-file';

export interface LocalDocumentStorage extends DocumentStorage {
  /** Verifies a link token (signature and expiry) and returns the file it grants. */
  readSigned(token: string, now?: Date): Promise<{ body: Buffer; contentType: string; fileName: string; inline: boolean }>;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Disk-backed driver for development and tests, with the same contract as the private bucket: no permanent
 * URL, links are HMAC-signed and valid for the TTL only. Rejected in production by the env schema.
 */
export function createLocalDocumentStorage(options: { root: string; secret?: string; now?: () => Date }): LocalDocumentStorage {
  const root = path.resolve(options.root);
  const secret = options.secret ?? crypto.randomBytes(32).toString('hex');
  const clock = options.now ?? (() => new Date());

  /** Keys are `<company>/<owner|company>/<uuid>`; anything that could leave `root` is refused. */
  function resolveKey(key: string): string {
    if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){1,3}$/.test(key)) throw new StorageError('Invalid storage key');
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new StorageError('Invalid storage key');
    return full;
  }
  const sign = (payload: string) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    driver: 'local',

    async put({ key, body }: PutObjectInput) {
      const full = resolveKey(key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      try {
        await fs.writeFile(full, body, { flag: 'wx' }); // never overwrite
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('Object already exists', 409);
        throw new StorageError('Could not write the file');
      }
    },

    async createSignedDownloadUrl(key: string, o: SignedUrlOptions) {
      resolveKey(key);
      const payload = b64(JSON.stringify({ k: key, e: clock().getTime() + o.expiresInSeconds * 1000, n: o.fileName ?? 'download', t: o.contentType ?? 'application/octet-stream', i: o.inline ? 1 : 0 }));
      return `${(o.requestOrigin ?? '').replace(/\/+$/, '')}/api/v1/documents${LOCAL_FILE_ROUTE}/${payload}.${sign(payload)}`;
    },

    async readSigned(token: string, now: Date = clock()) {
      const [payload, mac] = token.split('.');
      const expected = payload ? sign(payload) : '';
      if (!payload || !mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new StorageError('Invalid link', 403);
      let claims: { k: string; e: number; n: string; t: string; i?: number };
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        throw new StorageError('Invalid link', 403);
      }
      if (typeof claims.e !== 'number' || now.getTime() > claims.e) throw new StorageError('Link expired', 403);
      try {
        return { body: await fs.readFile(resolveKey(claims.k)), contentType: claims.t, fileName: claims.n, inline: claims.i === 1 };
      } catch {
        throw new StorageError('Stored file not found', 404);
      }
    },

    async remove(key: string) {
      await fs.rm(resolveKey(key), { force: true });
    },
  };
}
