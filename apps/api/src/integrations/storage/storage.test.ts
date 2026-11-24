import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStorage, createLocalDocumentStorage, createSupabaseDocumentStorage, SIGNED_URL_TTL_SECONDS, StorageError } from '.';

describe('signed URL lifetime', () => {
  it('is exactly 60 seconds (PRD DOC-003)', () => expect(SIGNED_URL_TTL_SECONDS).toBe(60));
});

describe('Supabase driver (REST, server-side only)', () => {
  const KEY = 'service-secret-key';
  const make = (fetchImpl: typeof fetch) => createSupabaseDocumentStorage({ url: 'https://abc.supabase.co/', serviceKey: KEY, bucket: 'hr-documents', fetchImpl });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('uploads to the private bucket without upsert and with the service key in headers only', async () => {
    const f = vi.fn(async () => json({ Key: 'x' }));
    await make(f as unknown as typeof fetch).put({ key: 'co-1/emp-1/uuid-1', body: Buffer.from('%PDF-1'), contentType: 'application/pdf' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/hr-documents/co-1/emp-1/uuid-1');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['x-upsert']).toBe('false');
    expect(h['Content-Type']).toBe('application/pdf');
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(url).not.toContain(KEY);
  });

  it('asks for a 60-second signed URL and returns an absolute link plus the download name', async () => {
    const f = vi.fn(async () => json({ signedURL: '/object/sign/hr-documents/co-1/emp-1/uuid-1?token=abc' }));
    const url = await make(f as unknown as typeof fetch).createSignedDownloadUrl('co-1/emp-1/uuid-1', { expiresInSeconds: SIGNED_URL_TTL_SECONDS, fileName: 'Offer letter.pdf' });
    const [called, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(called).toBe('https://abc.supabase.co/storage/v1/object/sign/hr-documents/co-1/emp-1/uuid-1');
    expect(JSON.parse(String(init.body))).toEqual({ expiresIn: 60 });
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/sign/hr-documents/co-1/emp-1/uuid-1?token=abc&download=Offer%20letter.pdf');
  });

  it('maps a missing object to 404 and hides provider details on other failures', async () => {
    await expect(make((async () => json({ message: 'Object not found' }, 400)) as unknown as typeof fetch).createSignedDownloadUrl('a/b', { expiresInSeconds: 60 })).rejects.toMatchObject({ status: 404 });
    const err = await make((async () => json({ message: 'secret bucket detail' }, 500)) as unknown as typeof fetch)
      .put({ key: 'a/b', body: Buffer.from('x'), contentType: 'image/png' })
      .catch((e: unknown) => e as StorageError);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).message).not.toContain('secret');
    expect((err as StorageError).message).not.toContain('hr-documents');
  });

  it('reports an unreachable service as a StorageError, never a raw network error', async () => {
    await expect(make((async () => { throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.1'); }) as unknown as typeof fetch).remove('a/b')).rejects.toThrow('Document storage is unreachable');
  });

  it('delete treats an already-missing object as success', async () => {
    await expect(make((async () => json({}, 404)) as unknown as typeof fetch).remove('a/b')).resolves.toBeUndefined();
  });
});

describe('local driver (development and tests)', () => {
  let root: string;
  let nowMs = Date.parse('2026-11-24T10:00:00Z');
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'gsc-docs-'));
    nowMs = Date.parse('2026-11-24T10:00:00Z');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const make = () => createLocalDocumentStorage({ root, secret: 's3cret', now: () => new Date(nowMs) });
  const tokenOf = (url: string) => url.split('/local-file/')[1]!;

  it('stores, signs for 60 seconds and serves; the link dies afterwards', async () => {
    const s = make();
    await s.put({ key: 'co/emp/u1', body: Buffer.from('hello'), contentType: 'text/plain' });
    const url = await s.createSignedDownloadUrl('co/emp/u1', { expiresInSeconds: 60, fileName: 'a.pdf', contentType: 'application/pdf', requestOrigin: 'http://localhost:4000' });
    expect(url.startsWith('http://localhost:4000/api/v1/documents/local-file/')).toBe(true);
    expect((await s.readSigned(tokenOf(url))).body.toString()).toBe('hello');
    nowMs += 59_000;
    await expect(s.readSigned(tokenOf(url), new Date(nowMs))).resolves.toBeTruthy();
    nowMs += 2_000;
    await expect(s.readSigned(tokenOf(url), new Date(nowMs))).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a tampered token and a token signed with another secret', async () => {
    const s = make();
    await s.put({ key: 'co/emp/u1', body: Buffer.from('x'), contentType: 'a/b' });
    const token = tokenOf(await s.createSignedDownloadUrl('co/emp/u1', { expiresInSeconds: 60 }));
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'co/emp/other', e: nowMs + 60_000, n: 'x', t: 'a/b' })).toString('base64url');
    await expect(s.readSigned(`${forged}.${mac}`)).rejects.toMatchObject({ status: 403 });
    await expect(s.readSigned(`${payload}.AAAA`)).rejects.toMatchObject({ status: 403 });
    const other = createLocalDocumentStorage({ root, secret: 'different' });
    await expect(other.readSigned(token)).rejects.toMatchObject({ status: 403 });
  });

  it('never overwrites and refuses keys that could leave the storage root', async () => {
    const s = make();
    await s.put({ key: 'co/emp/u1', body: Buffer.from('one'), contentType: 'a/b' });
    await expect(s.put({ key: 'co/emp/u1', body: Buffer.from('two'), contentType: 'a/b' })).rejects.toMatchObject({ status: 409 });
    for (const bad of ['../etc/passwd', 'co/../../x', '/abs/path', 'co//emp', 'co/emp/u 1', 'co']) {
      await expect(s.put({ key: bad, body: Buffer.from('x'), contentType: 'a/b' }), bad).rejects.toThrow('Invalid storage key');
    }
  });

  it('remove deletes the object and is idempotent', async () => {
    const s = make();
    await s.put({ key: 'co/emp/u1', body: Buffer.from('x'), contentType: 'a/b' });
    const token = tokenOf(await s.createSignedDownloadUrl('co/emp/u1', { expiresInSeconds: 60 }));
    await s.remove('co/emp/u1');
    await s.remove('co/emp/u1');
    await expect(s.readSigned(token)).rejects.toMatchObject({ status: 404 });
  });
});

describe('driver selection', () => {
  const base = { DOCUMENTS_STORAGE_DIR: undefined, DOCUMENTS_LOCAL_SIGNING_SECRET: undefined, SUPABASE_STORAGE_URL: undefined, SUPABASE_STORAGE_SERVICE_KEY: undefined, SUPABASE_STORAGE_BUCKET: 'hr-documents' };
  it('local by default, supabase when configured, and an incomplete supabase config throws', () => {
    expect(createDocumentStorage({ ...base, DOCUMENT_STORAGE_DRIVER: 'local' }).driver).toBe('local');
    expect(createDocumentStorage({ ...base, DOCUMENT_STORAGE_DRIVER: 'supabase', SUPABASE_STORAGE_URL: 'https://x.supabase.co', SUPABASE_STORAGE_SERVICE_KEY: 'k' }).driver).toBe('supabase');
    expect(() => createDocumentStorage({ ...base, DOCUMENT_STORAGE_DRIVER: 'supabase' })).toThrow('not configured');
  });
});
