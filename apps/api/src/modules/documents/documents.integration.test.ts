import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import type { createApp as CreateAppFn } from '../../app';
import type { DevAuthProvider as DevAuthProviderCls } from '../../integrations/central-auth/dev.provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documentDownloadResponseSchema, documentUploadResponseSchema } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { Harness, id } from '../../test/integration/api-harness';
import type { DocumentStorage, PutObjectInput, SignedUrlOptions } from '../../integrations/storage';
import { StorageError } from '../../integrations/storage';

/**
 * Documents against REAL PostgreSQL (scratch database) with the storage layer faked at its interface:
 * multipart upload, server-side validation, ownership/visibility/tenant checks, 60-second signed links,
 * soft delete. No Supabase is contacted anywhere in this file.
 */

pg.types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

class FakeStorage implements DocumentStorage {
  readonly driver = 'supabase' as const;
  objects = new Map<string, { body: Buffer; contentType: string }>();
  removed: string[] = [];
  signed: { key: string; options: SignedUrlOptions }[] = [];
  failPut = false;
  onPut?: () => Promise<void>;
  async put(i: PutObjectInput) {
    if (this.failPut) throw new StorageError('boom: bucket secret detail', 500);
    await this.onPut?.();
    this.objects.set(i.key, { body: i.body, contentType: i.contentType });
  }
  async createSignedDownloadUrl(key: string, options: SignedUrlOptions) {
    if (!this.objects.has(key)) throw new StorageError('Stored file not found', 404);
    this.signed.push({ key, options });
    return `https://storage.test/sign/${encodeURIComponent(key)}?ttl=${options.expiresInSeconds}`;
  }
  async remove(key: string) {
    this.removed.push(key);
    this.objects.delete(key);
  }
  reset() {
    this.objects.clear();
    this.removed = [];
    this.signed = [];
    this.failPut = false;
    this.onPut = undefined;
  }
}

type CreateApp = typeof CreateAppFn;
type DevAuthProviderClass = typeof DevAuthProviderCls;

const A = id();
const B = id();
const storage = new FakeStorage();
let admin: pg.Client;
let h: Harness;
let disconnect: () => Promise<void>;
let createApp: CreateApp;
let DevAuthProvider: DevAuthProviderClass;

beforeAll(async () => {
  const testAppUrl = testUrl('TEST_DATABASE_URL');
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testAppUrl;
  ({ createApp } = await import('../../app'));
  ({ DevAuthProvider } = await import('../../integrations/central-auth/dev.provider'));
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB);
  h = new Harness(admin, A, B);
  h.app = createApp({ authProvider: new DevAuthProvider(A), documentStorage: storage }) as Express;
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

const emp = (k: string) => h.people[k]!.emp;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

async function session(who: string) {
  if (!h.sessions[who]) await h.login(who);
}
const api = async (who: string, method: 'get' | 'patch' | 'delete', url: string, body?: unknown) => {
  await session(who);
  return h.api(who, method, url, body);
};
/** Multipart upload as `who`. */
async function upload(who: string, kind: 'employee' | 'company', opts: { fields?: Record<string, string>; file?: { buf: Buffer; name?: string; type?: string } | null } = {}) {
  await session(who);
  let req = h.raw(who, 'post', `/documents/${kind}`);
  for (const [k, v] of Object.entries(opts.fields ?? (kind === 'employee' ? { category: 'ID_PROOF' } : { category: 'POLICY' }))) req = req.field(k, v);
  const f = opts.file === undefined ? { buf: PDF } : opts.file;
  if (f) req = req.attach('file', f.buf, { filename: f.name ?? 'passport.pdf', contentType: f.type ?? 'application/pdf' });
  return req;
}
const docRow = async (docId: string) => (await admin.query(`SELECT * FROM hr.employee_documents WHERE id=$1`, [docId])).rows[0];
const docCount = async () => (await admin.query(`SELECT count(*)::int AS n FROM hr.employee_documents`)).rows[0].n as number;
const audit = async (action: string) => (await admin.query(`SELECT * FROM hr.audit_logs WHERE action=$1 ORDER BY "createdAt"`, [action])).rows;

beforeEach(async () => {
  storage.reset();
  await h.reset();
  // sa -> hr ; sa -> mgr -> team ; sa -> peer ; company B: hrb, empb
  await h.seedPerson(A, 'sa', 'SUPER_ADMIN');
  await h.seedPerson(A, 'hr', 'HR_ADMIN', 'sa');
  await h.seedPerson(A, 'mgr', 'MANAGER', 'sa');
  await h.seedPerson(A, 'team', 'EMPLOYEE', 'mgr');
  await h.seedPerson(A, 'peer', 'EMPLOYEE', 'sa');
  await h.seedPerson(B, 'hrb', 'HR_ADMIN');
  await h.seedPerson(B, 'empb', 'EMPLOYEE');
});

describe('multipart upload (DOC-001)', () => {
  it('stores the bytes under company/owner/uuid, keeps the display name, audits, and never returns the key', async () => {
    const res = await upload('team', 'employee', { file: { buf: PDF, name: 'My Passport.pdf' } });
    expect(res.status).toBe(201);
    expect(documentUploadResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data).toMatchObject({ fileName: 'My Passport.pdf', category: 'ID_PROOF', mimeType: 'application/pdf', sizeBytes: PDF.length });
    expect(JSON.stringify(res.body)).not.toContain('storedPath');
    const row = await docRow(res.body.data.id);
    expect(row.storedPath).toMatch(new RegExp(`^${A}/${emp('team')}/[0-9a-f-]{36}$`));
    expect(row.storedPath).not.toContain('Passport');
    expect(row.ownerEmployeeId).toBe(emp('team'));
    expect(row.uploadedByUserId).toBe(h.people.team!.user);
    expect(row.visibleToManager).toBe(false);
    expect(storage.objects.get(row.storedPath)!.body.equals(PDF)).toBe(true);
    expect(storage.objects.get(row.storedPath)!.contentType).toBe('application/pdf');
    const [a] = await audit('document.uploaded');
    expect(a.actorId).toBe(h.people.team!.user);
    expect(a.entityId).toBe(res.body.data.id);
  });

  it('accepts a 5 MB file (the old 1 MB JSON limit no longer applies) and exactly 10 MB, rejects 10 MB + 1 byte with 413', async () => {
    const big = (n: number) => Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(n - 5, 1)]);
    expect((await upload('team', 'employee', { file: { buf: big(5 * 1024 * 1024) } })).status).toBe(201);
    expect((await upload('team', 'employee', { file: { buf: big(10 * 1024 * 1024) } })).status).toBe(201);
    const before = storage.objects.size;
    const over = await upload('team', 'employee', { file: { buf: big(10 * 1024 * 1024 + 1) } });
    expect(over.status).toBe(413);
    expect(over.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(storage.objects.size).toBe(before);
    expect(await docCount()).toBe(2);
  });

  it('validates type and content on the server: wrong type, spoofed content, empty, no file, two files, JSON body', async () => {
    const cases: [string, Parameters<typeof upload>[2], number][] = [
      ['disallowed type', { file: { buf: Buffer.from('<html></html>'), name: 'x.html', type: 'text/html' } }, 400],
      ['spoofed pdf', { file: { buf: Buffer.from('<script>alert(1)</script>'), name: 'x.pdf', type: 'application/pdf' } }, 400],
      ['png bytes declared as pdf', { file: { buf: PNG, name: 'x.pdf', type: 'application/pdf' } }, 400],
      ['empty file', { file: { buf: Buffer.alloc(0), name: 'x.pdf' } }, 400],
      ['no file', { file: null }, 400],
      ['unknown field', { fields: { category: 'ID_PROOF', isAdmin: 'true' } }, 400],
      ['bad category', { fields: { category: 'PAYSLIP' } }, 400],
      ['missing category', { fields: {} }, 400],
      ['bad employee id', { fields: { category: 'ID_PROOF', employeeId: 'nope' } }, 400],
    ];
    for (const [label, opts, status] of cases) expect((await upload('team', 'employee', opts)).status, label).toBe(status);
    await session('team');
    const twoFiles = h.raw('team', 'post', '/documents/employee').field('category', 'ID_PROOF').attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' }).attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });
    expect((await twoFiles).status).toBe(400);
    const json = await h.raw('team', 'post', '/documents/employee').send({ category: 'ID_PROOF', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3, contentBase64: 'JVBE' });
    expect(json.status).toBe(415);
    expect(storage.objects.size).toBe(0);
    expect(await docCount()).toBe(0);
  });

  it('manager-visible flag is taken from the form; default is private', async () => {
    const res = await upload('team', 'employee', { fields: { category: 'CONTRACT', visibleToManager: 'true' } });
    expect((await docRow(res.body.data.id)).visibleToManager).toBe(true);
    expect((await upload('team', 'employee', { fields: { category: 'CONTRACT', visibleToManager: 'maybe' } })).status).toBe(400);
  });

  it('ownership: an Employee or Manager uploads only to their own record; HR and Super Admin to anyone in the company', async () => {
    expect((await upload('team', 'employee', { fields: { category: 'ID_PROOF', employeeId: emp('peer') } })).status).toBe(403);
    expect((await upload('mgr', 'employee', { fields: { category: 'ID_PROOF', employeeId: emp('team') } })).status).toBe(403);
    expect((await upload('team', 'employee', { fields: { category: 'ID_PROOF', employeeId: emp('team') } })).status).toBe(201);
    const byHr = await upload('hr', 'employee', { fields: { category: 'OFFER_LETTER', employeeId: emp('team') } });
    expect(byHr.status).toBe(201);
    expect((await docRow(byHr.body.data.id)).ownerEmployeeId).toBe(emp('team'));
    expect((await upload('sa', 'employee', { fields: { category: 'CONTRACT', employeeId: emp('peer') } })).status).toBe(201);
  });

  it('tenant isolation: an employee id from another company is 404 for everyone and nothing is stored', async () => {
    expect((await upload('hr', 'employee', { fields: { category: 'ID_PROOF', employeeId: emp('empb') } })).status).toBe(404);
    expect((await upload('hrb', 'employee', { fields: { category: 'ID_PROOF', employeeId: emp('team') } })).status).toBe(404);
    expect(storage.objects.size).toBe(0);
    expect(await docCount()).toBe(0);
  });

  it('company documents: HR/Super Admin only; Employee and Manager get 403 before anything is read', async () => {
    for (const who of ['team', 'mgr']) expect((await upload(who, 'company')).status, who).toBe(403);
    const res = await upload('hr', 'company', { fields: { category: 'HANDBOOK' } });
    expect(res.status).toBe(201);
    const row = await docRow(res.body.data.id);
    expect(row).toMatchObject({ isCompanyDocument: true, ownerEmployeeId: null, category: 'HANDBOOK' });
    expect(row.storedPath).toMatch(new RegExp(`^${A}/company/[0-9a-f-]{36}$`));
    expect((await upload('sa', 'company', { fields: {} })).status).toBe(201); // category defaults to POLICY
  });

  it('a storage outage is a generic 503 with no row; a failed insert removes the stored object again', async () => {
    storage.failPut = true;
    const down = await upload('team', 'employee');
    expect(down.status).toBe(503);
    expect(JSON.stringify(down.body)).not.toContain('secret');
    expect(await docCount()).toBe(0);
    storage.failPut = false;

    // The owner disappears after authorisation and before the insert: FK failure -> the object must not stay behind.
    const ghost = id();
    await admin.query(`INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName",status,"updatedAt") VALUES ($1,$2,'E-ghost','G','H','ACTIVE',now())`, [ghost, A]);
    storage.onPut = async () => {
      await admin.query(`DELETE FROM hr.employees WHERE id=$1`, [ghost]);
    };
    const res = await upload('hr', 'employee', { fields: { category: 'ID_PROOF', employeeId: ghost } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(storage.removed).toHaveLength(1);
    expect(storage.objects.size).toBe(0);
    expect(await docCount()).toBe(0);
  });

  it('requires a session and the CSRF header', async () => {
    expect((await request(h.app).post('/api/v1/documents/employee').field('category', 'ID_PROOF').attach('file', PDF, 'a.pdf')).status).toBe(401);
    await session('team');
    const noCsrf = request(h.app).post('/api/v1/documents/employee').set('cookie', h.sessions.team!.cookie).field('category', 'ID_PROOF').attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
    expect((await noCsrf).status).toBe(403);
    expect(storage.objects.size).toBe(0);
  });
});

describe('signed download (DOC-003) and visibility (DOC-002/004)', () => {
  const makeDoc = async (who: string, opts: { visible?: boolean; owner?: string } = {}) => {
    const res = await upload(who, 'employee', { fields: { category: 'ID_PROOF', ...(opts.owner ? { employeeId: opts.owner } : {}), ...(opts.visible ? { visibleToManager: 'true' } : {}) } });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  it('returns a JSON link valid for 60 seconds, not the bytes, and the response is not cacheable', async () => {
    const docId = await makeDoc('team');
    const res = await api('team', 'get', `/documents/${docId}/download`);
    expect(res.status).toBe(200);
    expect(documentDownloadResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data.expiresInSeconds).toBe(60);
    expect(res.body.data.url).toMatch(/^https:\/\/storage\.test\/sign\//);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toContain('application/json');
    expect(storage.signed).toHaveLength(1);
    expect(storage.signed[0]!.options).toMatchObject({ expiresInSeconds: 60, fileName: 'passport.pdf' });
  });

  it('owner and HR/SA can download; a peer Employee cannot; a Manager only for a direct report who made it visible', async () => {
    const priv = await makeDoc('team');
    const shared = await makeDoc('team', { visible: true });
    expect((await api('team', 'get', `/documents/${priv}/download`)).status).toBe(200);
    expect((await api('hr', 'get', `/documents/${priv}/download`)).status).toBe(200);
    expect((await api('sa', 'get', `/documents/${priv}/download`)).status).toBe(200);
    expect((await api('peer', 'get', `/documents/${priv}/download`)).status).toBe(403);
    expect((await api('mgr', 'get', `/documents/${priv}/download`)).status).toBe(403);
    expect((await api('mgr', 'get', `/documents/${shared}/download`)).status).toBe(200);
    const peerDoc = await makeDoc('peer', { visible: true });
    expect((await api('mgr', 'get', `/documents/${peerDoc}/download`)).status).toBe(403); // not mgr's report
    expect(storage.signed).toHaveLength(4); // team, hr, sa, mgr (shared); the three refusals issued no link
  });

  it('company documents are readable by every employee of that company', async () => {
    const res = await upload('hr', 'company');
    for (const who of ['team', 'mgr', 'peer']) expect((await api(who, 'get', `/documents/${res.body.data.id}/download`)).status, who).toBe(200);
  });

  it('cross-tenant: another company gets 404 (never a link), and sees nothing in its list', async () => {
    const docId = await makeDoc('team');
    const before = storage.signed.length;
    expect((await api('hrb', 'get', `/documents/${docId}/download`)).status).toBe(404);
    expect((await api('empb', 'get', `/documents/${docId}/download`)).status).toBe(404);
    expect(storage.signed).toHaveLength(before);
    expect((await api('hrb', 'get', '/documents')).body.data).toHaveLength(0);
    expect((await api('hrb', 'patch', `/documents/${docId}/visibility`, { visibleToManager: true })).status).toBe(404);
    expect((await api('hrb', 'delete', `/documents/${docId}`)).status).toBe(404);
    expect((await docRow(docId)).deletedAt).toBeNull();
  });

  it('a missing object is a 404, a malformed id is a 400, and a storage outage is a generic 503', async () => {
    const docId = await makeDoc('team');
    storage.objects.clear();
    expect((await api('team', 'get', `/documents/${docId}/download`)).status).toBe(404);
    expect((await api('team', 'get', '/documents/not-a-uuid/download')).status).toBe(400);
  });

  it('the list shows only what the caller may read and never exposes storage keys', async () => {
    await makeDoc('team');
    await makeDoc('team', { visible: true });
    await makeDoc('peer');
    await upload('hr', 'company');
    const mine = await api('team', 'get', '/documents');
    expect(mine.body.data).toHaveLength(3); // own 2 + company 1
    expect(JSON.stringify(mine.body)).not.toContain('storedPath');
    expect(JSON.stringify(mine.body)).not.toContain(A);
    const forMgr = await api('mgr', 'get', `/documents?employeeId=${emp('team')}`);
    expect(forMgr.body.data).toHaveLength(1); // only the visible one
    expect((await api('hr', 'get', '/documents')).body.data).toHaveLength(4);
  });

  it('visibility: only HR/SA can flip the flag, only on employee documents, with an audit row', async () => {
    const docId = await makeDoc('team');
    expect((await api('team', 'patch', `/documents/${docId}/visibility`, { visibleToManager: true })).status).toBe(403);
    expect((await api('mgr', 'patch', `/documents/${docId}/visibility`, { visibleToManager: true })).status).toBe(403);
    expect((await api('hr', 'patch', `/documents/${docId}/visibility`, { visibleToManager: true })).status).toBe(200);
    expect((await docRow(docId)).visibleToManager).toBe(true);
    expect((await api('mgr', 'get', `/documents/${docId}/download`)).status).toBe(200);
    const [a] = await audit('document.visibility_changed');
    expect(a.oldValue.visibleToManager).toBe(false);
    expect(a.newValue.visibleToManager).toBe(true);
    const company = await upload('hr', 'company');
    expect((await api('hr', 'patch', `/documents/${company.body.data.id}/visibility`, { visibleToManager: true })).status).toBe(404);
    expect((await api('hr', 'patch', `/documents/${docId}/visibility`, { visibleToManager: 'yes' })).status).toBe(400);
  });
});

describe('soft delete (DOC-005)', () => {
  it('hides the document at once, keeps the object for the 30-day retention window, audits it, and a second delete is 404', async () => {
    const created = await upload('team', 'employee');
    const docId = created.body.data.id as string;
    const key = (await docRow(docId)).storedPath as string;
    const del = await api('hr', 'delete', `/documents/${docId}`);
    expect(del.status).toBe(204);
    const row = await docRow(docId);
    expect(row.deletedAt).not.toBeNull();
    const days = (new Date(row.purgeAfterAt).getTime() - new Date(row.deletedAt).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 3);
    expect(storage.objects.has(key)).toBe(true); // not purged yet: recoverable
    expect(storage.removed).toHaveLength(0);
    expect((await api('team', 'get', `/documents/${docId}/download`)).status).toBe(404);
    expect((await api('hr', 'get', `/documents/${docId}/download`)).status).toBe(404);
    expect((await api('team', 'get', '/documents')).body.data).toHaveLength(0);
    expect((await api('hr', 'delete', `/documents/${docId}`)).status).toBe(404);
    const [a] = await audit('document.deleted');
    expect(a.actorId).toBe(h.people.hr!.user);
    expect(a.entityId).toBe(docId);
  });

  it('only HR/SA delete: Employee (even the owner) and Manager get 403 and the document stays', async () => {
    const created = await upload('team', 'employee');
    const docId = created.body.data.id as string;
    for (const who of ['team', 'mgr', 'peer']) expect((await api(who, 'delete', `/documents/${docId}`)).status, who).toBe(403);
    expect((await docRow(docId)).deletedAt).toBeNull();
    expect((await api('sa', 'delete', `/documents/${docId}`)).status).toBe(204);
  });
});

describe('local driver end to end (development): signed link served by the API without a session', () => {
  it('upload, link, fetch the bytes with no cookie, and a tampered link is refused', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gsc-docs-it-'));
    try {
      const { createLocalDocumentStorage } = await import('../../integrations/storage');
      const local = createLocalDocumentStorage({ root, secret: 'it-secret' });
      const app = createApp({ authProvider: new DevAuthProvider(A), documentStorage: local }) as Express;
      const prev = h.app;
      h.app = app;
      try {
        const up = await upload('team', 'employee', { file: { buf: PDF, name: 'cv.pdf' } });
        expect(up.status).toBe(201);
        const link = await api('team', 'get', `/documents/${up.body.data.id}/download`);
        expect(link.status).toBe(200);
        const url = new URL(link.body.data.url);
        expect(url.pathname.startsWith('/api/v1/documents/local-file/')).toBe(true);
        const file = await request(app).get(url.pathname).buffer(true).parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(file.status).toBe(200);
        expect((file.body as Buffer).equals(PDF)).toBe(true);
        expect(file.headers['content-disposition']).toContain('cv.pdf');
        expect(file.headers['cache-control']).toBe('no-store');
        expect((await request(app).get(`${url.pathname}x`)).status).toBe(403);
        expect((await request(app).get('/api/v1/documents/local-file/garbage')).status).toBe(403);
      } finally {
        h.app = prev;
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
