import { StorageError, type DocumentStorage, type PutObjectInput, type SignedUrlOptions } from './types';

export interface SupabaseStorageConfig {
  /** Project base URL, e.g. https://<ref>.supabase.co */
  url: string;
  /** Server-side service key. Only ever sent to Supabase in request headers. */
  serviceKey: string;
  /** Name of a PRIVATE bucket. */
  bucket: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/**
 * Supabase Storage through its REST API (no SDK, so nothing here can leak the key to a client bundle).
 * - upload: `x-upsert: false`, so an object is never overwritten;
 * - download: `/object/sign` with a 60-second `expiresIn`; the bucket itself stays private;
 * - errors carry the HTTP status but never the key or the response body.
 */
export function createSupabaseDocumentStorage(config: SupabaseStorageConfig): DocumentStorage {
  const base = `${config.url.replace(/\/+$/, '')}/storage/v1`;
  const bucket = encodeURIComponent(config.bucket);
  const doFetch = config.fetchImpl ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, ...extra });

  async function call(url: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs ?? 15_000);
    try {
      return await doFetch(url, { ...init, signal: ctl.signal });
    } catch {
      throw new StorageError('Document storage is unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    driver: 'supabase',

    async put({ key, body, contentType }: PutObjectInput) {
      const res = await call(`${base}/object/${bucket}/${encodeKey(key)}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'private, max-age=0' }),
        body: new Uint8Array(body),
      });
      if (!res.ok) throw new StorageError(`Document storage rejected the upload (HTTP ${res.status})`, res.status);
    },

    async createSignedDownloadUrl(key: string, options: SignedUrlOptions) {
      const res = await call(`${base}/object/sign/${bucket}/${encodeKey(key)}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: options.expiresInSeconds }),
      });
      if (res.status === 404 || res.status === 400) throw new StorageError('Stored file not found', 404);
      if (!res.ok) throw new StorageError(`Document storage could not sign the link (HTTP ${res.status})`, res.status);
      const json = (await res.json().catch(() => null)) as { signedURL?: string; signedUrl?: string } | null;
      const signed = json?.signedURL ?? json?.signedUrl;
      if (!signed) throw new StorageError('Document storage returned no signed link');
      const absolute = signed.startsWith('http') ? signed : `${base}${signed.startsWith('/') ? '' : '/'}${signed}`;
      return options.fileName && !options.inline ? `${absolute}${absolute.includes('?') ? '&' : '?'}download=${encodeURIComponent(options.fileName)}` : absolute;
    },

    async remove(key: string) {
      const res = await call(`${base}/object/${bucket}/${encodeKey(key)}`, { method: 'DELETE', headers: headers() });
      if (!res.ok && res.status !== 404) throw new StorageError(`Document storage could not delete the object (HTTP ${res.status})`, res.status);
    },
  };
}
