import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDocumentStorage, createIdentityDocumentStorage, IDENTITY_LOCAL_ROUTE_BASE, type LocalDocumentStorage } from '../../integrations/storage';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gsc-identity-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));

const env = {
  DOCUMENT_STORAGE_DRIVER: 'local' as const,
  IDENTITY_DOCUMENTS_STORAGE_DIR: path.join(root, 'identity'),
  DOCUMENTS_STORAGE_DIR: path.join(root, 'documents'),
  DOCUMENTS_LOCAL_SIGNING_SECRET: 'shared-dev-secret',
  SUPABASE_STORAGE_URL: undefined,
  SUPABASE_STORAGE_SERVICE_KEY: undefined,
  SUPABASE_STORAGE_BUCKET: 'hr-documents',
  SUPABASE_IDENTITY_BUCKET: 'hr-identity-documents',
};

describe('identity document storage', () => {
  it('signs links to its own route, which expire after the TTL', async () => {
    const s = createIdentityDocumentStorage(env) as LocalDocumentStorage;
    await s.put({ key: 'co/emp/abc', body: Buffer.from('%PDF-x'), contentType: 'application/pdf' });
    const url = await s.createSignedDownloadUrl('co/emp/abc', { expiresInSeconds: 60, requestOrigin: 'http://api.test', contentType: 'application/pdf', inline: true });
    expect(url.startsWith(`http://api.test${IDENTITY_LOCAL_ROUTE_BASE}/local-file/`)).toBe(true);
    const token = url.split('/local-file/')[1]!;
    expect((await s.readSigned(token)).body.toString()).toBe('%PDF-x');
    await expect(s.readSigned(token, new Date(Date.now() + 61_000))).rejects.toMatchObject({ status: 403 });
  });

  it('a link signed for identity files is not valid against the general documents storage (separate secret and root)', async () => {
    const identity = createIdentityDocumentStorage(env) as LocalDocumentStorage;
    const documents = createDocumentStorage(env) as LocalDocumentStorage;
    await identity.put({ key: 'co/emp/def', body: Buffer.from('%PDF-y'), contentType: 'application/pdf' });
    const token = (await identity.createSignedDownloadUrl('co/emp/def', { expiresInSeconds: 60 })).split('/local-file/')[1]!;
    await expect(documents.readSigned(token)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses keys that could escape the storage root', async () => {
    const s = createIdentityDocumentStorage(env);
    await expect(s.put({ key: '../../etc/passwd', body: Buffer.from('x'), contentType: 'image/png' })).rejects.toThrow();
    await expect(s.put({ key: 'co/../../x', body: Buffer.from('x'), contentType: 'image/png' })).rejects.toThrow();
  });
});
