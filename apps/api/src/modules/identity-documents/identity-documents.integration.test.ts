import crypto from 'node:crypto';
import pg from 'pg';
import type { Express } from 'express';
import type { createApp as CreateAppFn } from '../../app';
import type { DevAuthProvider as DevAuthProviderCls } from '../../integrations/central-auth/dev.provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { identityDocumentLinkResponseSchema, identityDocumentResponseSchema, verhoeffValid } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { Harness, id } from '../../test/integration/api-harness';
import { StorageError, type DocumentStorage, type PutObjectInput, type SignedUrlOptions } from '../../integrations/storage';
import { createIdentityCipher, type IdentityCipher } from './identity-crypto';
import { purgeExpiredIdentityDocuments } from './identity-retention';

/**
 * Government ID documents against REAL PostgreSQL (scratch database, RLS active, runtime role) with the storage
 * layer faked at its interface. Covers permissions per role, tenant isolation, validation, encryption at rest,
 * signed links, Super Admin-only reveal, replacement history, orphan cleanup, deletion, purge and auditing.
 */

pg.types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

class FakeStorage implements DocumentStorage {
  readonly driver = 'supabase' as const;
  objects = new Map<string, { body: Buffer; contentType: string }>();
  removed: string[] = [];
  signed: { key: string; options: SignedUrlOptions }[] = [];
  failPutAt: number | null = null;
  puts = 0;
  onPut?: () => Promise<void>;
  async put(i: PutObjectInput) {
    this.puts += 1;
    if (this.failPutAt === this.puts) throw new StorageError('boom: bucket secret detail', 500);
    await this.onPut?.();
    this.objects.set(i.key, { body: i.body, contentType: i.contentType });
  }
  async createSignedDownloadUrl(key: string, options: SignedUrlOptions) {
    if (!this.objects.has(key)) throw new StorageError('Stored file not found', 404);
    this.signed.push({ key, options });
    return `https://storage.test/sign/opaque-${this.signed.length}?ttl=${options.expiresInSeconds}`;
  }
  async remove(key: string) {
    this.removed.push(key);
    this.objects.delete(key);
  }
  reset() {
    this.objects.clear();
    this.removed = [];
    this.signed = [];
    this.failPutAt = null;
    this.puts = 0;
    this.onPut = undefined;
  }
}

type CreateApp = typeof CreateAppFn;
type DevAuthProviderClass = typeof DevAuthProviderCls;

const A = id();
const B = id();
const storage = new FakeStorage();
const cipher: IdentityCipher = createIdentityCipher(crypto.randomBytes(32).toString('base64'));
let admin: pg.Client;
let h: Harness;
let noCipherApp: Express;
let disconnect: () => Promise<void>;
let createApp: CreateApp;
let DevAuthProvider: DevAuthProviderClass;

function withCheckDigit(base11: string): string {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(base11 + d)) return base11 + d;
  throw new Error('unreachable');
}
const AADHAAR = withCheckDigit('23456789012');
const AADHAAR_2 = withCheckDigit('98765432109');
const PAN = 'ABCPE1234F';

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testUrl('TEST_DATABASE_URL');
  ({ createApp } = await import('../../app'));
  ({ DevAuthProvider } = await import('../../integrations/central-auth/dev.provider'));
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB);
  h = new Harness(admin, A, B);
  h.app = createApp({ authProvider: new DevAuthProvider(A), identityDocumentStorage: storage, identityCipher: cipher }) as Express;
  noCipherApp = createApp({ authProvider: new DevAuthProvider(A), identityDocumentStorage: storage, identityCipher: null }) as Express;
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

const emp = (k: string) => h.people[k]!.emp;
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024, 7)]);

async function session(who: string) {
  if (!h.sessions[who]) await h.login(who);
}
const base = (employeeId: string) => `/employees/${employeeId}/identity-document`;
const get = async (who: string, url: string) => {
  await session(who);
  return h.raw(who, 'get', url);
};
type FileSpec = { buf: Buffer; name?: string; type?: string } | null;
async function submit(
  who: string,
  employeeId: string,
  o: { fields?: Record<string, string>; front?: FileSpec; back?: FileSpec; extraFile?: boolean } = {},
) {
  await session(who);
  const s = h.sessions[who]!;
  const request = (await import('supertest')).default;
  let req = request(h.app).put(`/api/v1${base(employeeId)}`).set('cookie', s.cookie).set('x-csrf-token', s.csrf);
  for (const [k, v] of Object.entries(o.fields ?? { documentType: 'AADHAAR', documentNumber: AADHAAR, consent: 'true' })) req = req.field(k, v);
  const front = o.front === undefined ? { buf: JPG, name: 'front.jpg', type: 'image/jpeg' } : o.front;
  const back = o.back === undefined ? { buf: PNG, name: 'back.png', type: 'image/png' } : o.back;
  if (front) req = req.attach('front', front.buf, { filename: front.name ?? 'front.jpg', contentType: front.type ?? 'image/jpeg' });
  if (back) req = req.attach('back', back.buf, { filename: back.name ?? 'back.png', contentType: back.type ?? 'image/png' });
  if (o.extraFile) req = req.attach('selfie', JPG, { filename: 'x.jpg', contentType: 'image/jpeg' });
  return req;
}
const post = async (who: string, url: string) => {
  await session(who);
  return h.raw(who, 'post', url);
};
const del = async (who: string, url: string) => {
  await session(who);
  return h.raw(who, 'delete', url);
};
const rows = async (employeeId?: string) =>
  (await admin.query(`SELECT * FROM hr.employee_identity_documents ${employeeId ? 'WHERE "employeeId"=$1' : ''} ORDER BY "createdAt"`, employeeId ? [employeeId] : [])).rows;
const audits = async (prefix = 'identity_document.') => (await admin.query(`SELECT * FROM hr.audit_logs WHERE action LIKE $1 ORDER BY "createdAt"`, [`${prefix}%`])).rows;

beforeEach(async () => {
  storage.reset();
  await h.reset();
  // sa -> hr ; sa -> mgr -> team ; sa -> peer ; company B: hrb, empb, sab
  await h.seedPerson(A, 'sa', 'SUPER_ADMIN');
  await h.seedPerson(A, 'hr', 'HR_ADMIN', 'sa');
  await h.seedPerson(A, 'mgr', 'MANAGER', 'sa');
  await h.seedPerson(A, 'team', 'EMPLOYEE', 'mgr');
  await h.seedPerson(A, 'peer', 'EMPLOYEE', 'sa');
  await h.seedPerson(B, 'hrb', 'HR_ADMIN');
  await h.seedPerson(B, 'sab', 'SUPER_ADMIN');
  await h.seedPerson(B, 'empb', 'EMPLOYEE');
});

describe('submission and validation', () => {
  it('HR submits for an employee: files under company/employee/uuid, number encrypted at rest, masked response, audited', async () => {
    const res = await submit('hr', emp('team'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(identityDocumentResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data).toMatchObject({ employeeId: emp('team'), documentType: 'AADHAAR', maskedNumber: `XXXX XXXX ${AADHAAR.slice(-4)}`, front: { mimeType: 'image/jpeg' }, back: { mimeType: 'image/png' } });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(AADHAAR);
    expect(body).not.toMatch(/frontPath|backPath|Ciphertext/);
    const [row] = await rows(emp('team'));
    expect(row.frontPath).toMatch(new RegExp(`^${A}/${emp('team')}/[0-9a-f-]{36}$`));
    expect(row.backPath).toMatch(new RegExp(`^${A}/${emp('team')}/[0-9a-f-]{36}$`));
    expect(row.numberCiphertext).not.toContain(AADHAAR);
    expect(row.numberCiphertext).not.toContain(AADHAAR.slice(0, 8));
    expect(row.numberLast4).toBe(AADHAAR.slice(-4));
    expect(row.consentRecordedByUserId).toBe(h.people.hr!.user);
    expect(storage.objects.get(row.frontPath)!.body.equals(JPG)).toBe(true);
    const [a] = await audits();
    expect(a).toMatchObject({ action: 'identity_document.uploaded', actorId: h.people.hr!.user, entityId: row.id });
    expect(a.newValue).toMatchObject({ employeeId: emp('team'), documentType: 'AADHAAR', hasBack: true });
  });

  it('an employee submits their own; PAN needs no back side; normalisation applies', async () => {
    const res = await submit('team', emp('team'), { fields: { documentType: 'PAN', documentNumber: ' abcpe1234f ', consent: 'true' }, back: null });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ documentType: 'PAN', maskedNumber: 'XXXXXX234F', back: null });
    const [row] = await rows(emp('team'));
    expect(cipher.decrypt(row.numberCiphertext, `gsc-identity-v1|${A}|${emp('team')}|PAN`)).toBe(PAN);
  });

  it('rejects invalid numbers for each type, with messages that never echo the input', async () => {
    const cases: [string, string][] = [
      ['AADHAAR', '123456789012'],
      ['AADHAAR', AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10)],
      ['PAN', 'ABCDE12345'],
      ['DRIVING_LICENCE', 'XX1220110012345'],
      ['VOTER_ID', 'AB12345678'],
    ];
    for (const [documentType, documentNumber] of cases) {
      const res = await submit('hr', emp('team'), { fields: { documentType, documentNumber, consent: 'true' } });
      expect(res.status, documentType).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(documentNumber);
      expect(res.body.error.details[0].path).toBe('documentNumber');
    }
    expect(storage.objects.size).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it('accepts valid driving licence and voter ID numbers', async () => {
    expect((await submit('hr', emp('team'), { fields: { documentType: 'DRIVING_LICENCE', documentNumber: 'MH12 20110012345', consent: 'true' } })).status).toBe(201);
    expect((await submit('hr', emp('peer'), { fields: { documentType: 'VOTER_ID', documentNumber: 'abc1234567', consent: 'true' } })).status).toBe(201);
  });

  it('requires front, back (except PAN) and consent', async () => {
    const noFront = await submit('hr', emp('team'), { front: null });
    expect(noFront.status).toBe(400);
    expect(noFront.body.error.details.map((d: { path: string }) => d.path)).toContain('front');
    for (const documentType of ['AADHAAR', 'DRIVING_LICENCE', 'VOTER_ID']) {
      const number = { AADHAAR, DRIVING_LICENCE: 'KA0120080001234', VOTER_ID: 'ABC1234567' }[documentType]!;
      const res = await submit('hr', emp('team'), { fields: { documentType, documentNumber: number, consent: 'true' }, back: null });
      expect(res.status, documentType).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('back');
    }
    expect((await submit('hr', emp('team'), { fields: { documentType: 'AADHAAR', documentNumber: AADHAAR } })).status).toBe(400);
    expect((await submit('hr', emp('team'), { fields: { documentType: 'AADHAAR', documentNumber: AADHAAR, consent: 'false' } })).status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it('validates files on the server: extension, MIME type, content signature, size, unknown parts', async () => {
    const bad: [string, Parameters<typeof submit>[2], number][] = [
      ['gif', { front: { buf: Buffer.from('GIF89a....'), name: 'f.gif', type: 'image/gif' } }, 400],
      ['docx', { front: { buf: Buffer.from([0x50, 0x4b, 0x03, 0x04]), name: 'f.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }, 400],
      ['html as jpg', { front: { buf: Buffer.from('<html><script>x</script></html>'), name: 'f.jpg', type: 'image/jpeg' } }, 400],
      ['png bytes declared jpeg', { front: { buf: PNG, name: 'f.jpg', type: 'image/jpeg' } }, 400],
      ['extension mismatch', { front: { buf: JPG, name: 'f.pdf', type: 'image/jpeg' } }, 400],
      ['empty', { front: { buf: Buffer.alloc(0), name: 'f.jpg', type: 'image/jpeg' } }, 400],
      ['back spoofed pdf', { back: { buf: Buffer.from('not a pdf'), name: 'b.pdf', type: 'application/pdf' } }, 400],
      ['extra file part', { extraFile: true }, 400],
      ['unknown field', { fields: { documentType: 'PAN', documentNumber: PAN, consent: 'true', employeeId: emp('peer') } }, 400],
    ];
    for (const [label, o, status] of bad) expect((await submit('hr', emp('team'), o)).status, label).toBe(status);
    const big = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n - 3, 1)]);
    expect((await submit('hr', emp('team'), { front: { buf: big(5 * 1024 * 1024 + 1), name: 'f.jpg', type: 'image/jpeg' } })).status).toBe(413);
    expect(storage.objects.size).toBe(0);
    expect(await rows()).toHaveLength(0);
    // exactly 5 MB is accepted; PDF is accepted
    expect((await submit('hr', emp('team'), { front: { buf: big(5 * 1024 * 1024), name: 'f.jpeg', type: 'image/jpeg' }, back: { buf: PDF, name: 'b.pdf', type: 'application/pdf' } })).status).toBe(201);
  });

  it('a JSON body is refused (415)', async () => {
    await session('hr');
    const request = (await import('supertest')).default;
    const s = h.sessions.hr!;
    const res = await request(h.app).put(`/api/v1${base(emp('team'))}`).set('cookie', s.cookie).set('x-csrf-token', s.csrf).send({ documentType: 'PAN', documentNumber: PAN, consent: 'true' });
    expect(res.status).toBe(415);
  });
});

describe('permissions (enforced on the server)', () => {
  it('Employee and Manager cannot submit for anyone else; Super Admin can', async () => {
    expect((await submit('team', emp('peer'))).status).toBe(403);
    expect((await submit('mgr', emp('team'))).status).toBe(403);
    expect((await submit('sa', emp('peer'))).status).toBe(201);
    expect(storage.objects.size).toBe(2);
  });

  it('read: HR and Super Admin any employee; Employee only self; Manager no access to their team', async () => {
    await submit('hr', emp('team'));
    for (const who of ['hr', 'sa', 'team']) {
      const res = await get(who, base(emp('team')));
      expect(res.status, who).toBe(200);
      expect(res.body.data.maskedNumber).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
      expect(JSON.stringify(res.body)).not.toContain(AADHAAR);
    }
    expect((await get('mgr', base(emp('team')))).status).toBe(403);
    expect((await get('peer', base(emp('team')))).status).toBe(403);
    expect((await get('mgr', `${base(emp('team'))}/front/link`)).status).toBe(403);
    expect((await get('peer', `${base(emp('team'))}/back/link`)).status).toBe(403);
  });

  it('an employee with no document gets data: null (existing records stay compatible)', async () => {
    const res = await get('peer', base(emp('peer')));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: null });
  });

  it('only Super Admin can reveal the full number; HR, Manager and Employee (even for self) get 403; reveal is audited without the number', async () => {
    await submit('hr', emp('team'));
    for (const who of ['hr', 'mgr', 'team']) expect((await post(who, `${base(emp('team'))}/reveal`)).status, who).toBe(403);
    expect(await audits('identity_document.number_revealed')).toHaveLength(0);
    const res = await post('sa', `${base(emp('team'))}/reveal`);
    expect(res.status).toBe(200);
    expect(res.body.data.documentNumber).toBe(AADHAAR);
    expect(res.headers['cache-control']).toBe('no-store');
    const [a] = await audits('identity_document.number_revealed');
    expect(a.actorId).toBe(h.people.sa!.user);
    expect(a.newValue).toMatchObject({ employeeId: emp('team') });
  });

  it('delete: HR and Super Admin only', async () => {
    await submit('team', emp('team'));
    expect((await del('team', base(emp('team')))).status).toBe(403);
    expect((await del('mgr', base(emp('team')))).status).toBe(403);
    expect((await del('hr', base(emp('team')))).status).toBe(204);
    expect((await get('team', base(emp('team')))).body).toEqual({ data: null });
    expect((await del('hr', base(emp('team')))).status).toBe(404);
  });

  it('a malformed employee id is a 400', async () => {
    expect((await get('hr', base('not-a-uuid'))).status).toBe(400);
  });
});

describe('tenant isolation', () => {
  it('another company: 404 for HR and Super Admin on read, link, reveal, submit and delete; nothing stored', async () => {
    await submit('hr', emp('team'));
    storage.reset();
    expect((await get('hrb', base(emp('team')))).status).toBe(404);
    expect((await get('hrb', `${base(emp('team'))}/front/link`)).status).toBe(404);
    expect((await post('sab', `${base(emp('team'))}/reveal`)).status).toBe(404);
    expect((await submit('hrb', emp('team'))).status).toBe(404);
    expect((await del('hrb', base(emp('team')))).status).toBe(404);
    expect((await submit('hr', emp('empb'))).status).toBe(404);
    expect(storage.objects.size).toBe(0);
    expect(storage.signed).toHaveLength(0);
    expect(await rows(emp('empb'))).toHaveLength(0);
    expect((await rows(emp('team')))[0].deletedAt).toBeNull();
  });

  it('a ciphertext moved to another employee does not decrypt (bound to tenant, employee and type)', async () => {
    await submit('hr', emp('team'));
    await submit('hr', emp('peer'), { fields: { documentType: 'AADHAAR', documentNumber: AADHAAR_2, consent: 'true' } });
    const [teamRow] = await rows(emp('team'));
    await admin.query(`UPDATE hr.employee_identity_documents SET "numberCiphertext"=$1 WHERE "employeeId"=$2`, [teamRow.numberCiphertext, emp('peer')]);
    const res = await post('sa', `${base(emp('peer'))}/reveal`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(AADHAAR);
  });
});

describe('signed links', () => {
  it('issues a 60-second link only after authorisation, audits the view, and never returns the storage key', async () => {
    await submit('hr', emp('team'));
    const [row] = await rows(emp('team'));
    const res = await get('hr', `${base(emp('team'))}/front/link?inline=true`);
    expect(res.status).toBe(200);
    expect(identityDocumentLinkResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.data.expiresInSeconds).toBe(60);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain(row.frontPath);
    expect(storage.signed[0]).toMatchObject({ key: row.frontPath, options: { expiresInSeconds: 60, inline: true, contentType: 'image/jpeg', fileName: 'aadhaar-front.jpg' } });
    const own = await get('team', `${base(emp('team'))}/back/link`);
    expect(own.status).toBe(200);
    expect(storage.signed[1]!.options).toMatchObject({ fileName: 'aadhaar-back.png', inline: false });
    const views = await audits('identity_document.viewed');
    expect(views.map((v) => [v.actorId, v.newValue.side])).toEqual([
      [h.people.hr!.user, 'front'],
      [h.people.team!.user, 'back'],
    ]);
    for (const v of views) expect(JSON.stringify(v)).not.toMatch(/storage\.test|opaque|sign/);
  });

  it('back link for a PAN without back side is 404; no document is 404; bad side is 400', async () => {
    await submit('team', emp('team'), { fields: { documentType: 'PAN', documentNumber: PAN, consent: 'true' }, back: null });
    expect((await get('team', `${base(emp('team'))}/back/link`)).status).toBe(404);
    expect((await get('hr', `${base(emp('peer'))}/front/link`)).status).toBe(404);
    expect((await get('hr', `${base(emp('team'))}/selfie/link`)).status).toBe(400);
    expect(storage.signed).toHaveLength(0);
  });

  it('no audit, no link: the view audit is written before the link is returned', async () => {
    await submit('hr', emp('team'));
    const before = (await audits('identity_document.viewed')).length;
    const res = await get('hr', `${base(emp('team'))}/front/link`);
    expect(res.status).toBe(200);
    expect((await audits('identity_document.viewed')).length).toBe(before + 1);
  });
});

describe('replacement, deletion and history', () => {
  it('replacing keeps the old row (soft-deleted, purge in 30 days) and its files, keeps the first upload date, audits', async () => {
    const first = await submit('team', emp('team'));
    const [old] = await rows(emp('team'));
    const res = await submit('hr', emp('team'), { fields: { documentType: 'PAN', documentNumber: PAN, consent: 'true' }, back: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ documentType: 'PAN', uploadedAt: first.body.data.uploadedAt });
    expect(res.body.data.updatedAt >= first.body.data.updatedAt).toBe(true);
    const all = await rows(emp('team'));
    expect(all).toHaveLength(2);
    const retired = all.find((r) => r.id === old.id)!;
    expect(retired.deletedAt).not.toBeNull();
    expect(retired.purgeAfterAt.getTime() - retired.deletedAt.getTime()).toBe(30 * 86_400_000);
    expect(storage.objects.has(old.frontPath)).toBe(true); // recoverable until purge
    const [replaced] = await audits('identity_document.replaced');
    expect(replaced.newValue).toMatchObject({ previousDocumentId: old.id, documentType: 'PAN' });
  });

  it('deletion is audited; purge removes files and row after retention, never active documents or other tenants', async () => {
    await submit('hr', emp('team'));
    await submit('hr', emp('peer'), { fields: { documentType: 'AADHAAR', documentNumber: AADHAAR_2, consent: 'true' } });
    const [teamRow] = await rows(emp('team'));
    const [peerRow] = await rows(emp('peer'));
    expect((await del('hr', base(emp('team')))).status).toBe(204);
    const [d] = await audits('identity_document.deleted');
    expect(d).toMatchObject({ actorId: h.people.hr!.user, entityId: teamRow.id });

    const { createTenantRunner } = await import('../../database/tenant');
    const { getPrisma } = await import('../../database/client');
    const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const runner = createTenantRunner(getPrisma());
    const early = await purgeExpiredIdentityDocuments({ companyId: A, runner, storage, log, now: new Date(Date.now() + 29 * 86_400_000) });
    expect(early.scanned).toBe(0);
    const dry = await purgeExpiredIdentityDocuments({ companyId: A, runner, storage, log, dryRun: true, now: new Date(Date.now() + 31 * 86_400_000) });
    expect(dry.scanned).toBe(1);
    expect(storage.objects.has(teamRow.frontPath)).toBe(true);
    const other = await purgeExpiredIdentityDocuments({ companyId: B, runner, storage, log, now: new Date(Date.now() + 31 * 86_400_000) });
    expect(other.scanned).toBe(0);
    const done = await purgeExpiredIdentityDocuments({ companyId: A, runner, storage, log, now: new Date(Date.now() + 31 * 86_400_000) });
    expect(done).toMatchObject({ scanned: 1, purged: 1, failed: 0 });
    expect(storage.objects.has(teamRow.frontPath)).toBe(false);
    expect(storage.objects.has(teamRow.backPath)).toBe(false);
    expect(await rows(emp('team'))).toHaveLength(0);
    expect(storage.objects.has(peerRow.frontPath)).toBe(true);
    expect(await rows(emp('peer'))).toHaveLength(1);
    expect(await audits('identity_document.purged')).toHaveLength(1);
  });
});

describe('failure handling: no orphaned files', () => {
  it('storage failure on the back file removes the already stored front file; 503 without provider details', async () => {
    storage.failPutAt = 2;
    const res = await submit('hr', emp('team'));
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/bucket|secret|boom/);
    expect(storage.objects.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
  });

  it('a database failure after the upload (concurrent submission wins) removes the new files; 409', async () => {
    let injected = false;
    storage.onPut = async () => {
      if (injected) return;
      injected = true;
      // Another submission commits between our pre-check and our transaction.
      await admin.query(
        `INSERT INTO hr.employee_identity_documents (id,"companyId","employeeId","documentType","numberCiphertext","numberLast4","frontPath","frontMimeType","frontSizeBytes","consentRecordedAt","firstUploadedAt","updatedAt")
         VALUES ($1,$2,$3,'PAN','v1:AAAA:BBBB:CCCC','234F',$4,'image/jpeg',10,now(),now(),now())`,
        [id(), A, emp('team'), `${A}/${emp('team')}/${id()}`],
      );
    };
    const res = await submit('hr', emp('team'));
    expect(res.status).toBe(409);
    expect(storage.objects.size).toBe(0);
    expect(storage.removed).toHaveLength(2);
    expect(await rows(emp('team'))).toHaveLength(1);
    expect(await audits('identity_document.uploaded')).toHaveLength(0);
  });

  it('without an encryption key every endpoint answers 503 and nothing is stored', async () => {
    const request = (await import('supertest')).default;
    await session('hr');
    const s = h.sessions.hr!;
    const res = await request(noCipherApp).get(`/api/v1${base(emp('team'))}`).set('cookie', s.cookie);
    expect(res.status).toBe(503);
    const up = await request(noCipherApp)
      .put(`/api/v1${base(emp('team'))}`)
      .set('cookie', s.cookie)
      .set('x-csrf-token', s.csrf)
      .field('documentType', 'PAN')
      .field('documentNumber', PAN)
      .field('consent', 'true')
      .attach('front', JPG, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(503);
    expect(storage.objects.size).toBe(0);
  });
});

describe('employee creation with documents (two-step flow)', () => {
  it('HR creates an employee, then submits the document; creation stands on its own if the document step fails', async () => {
    const dept = id();
    const desig = id();
    await admin.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now())`, [dept, A]);
    await admin.query(`INSERT INTO hr.designations (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineer',now())`, [desig, A]);
    await session('hr');
    const created = await h.api('hr', 'post', '/employees', { firstName: 'Asha', lastName: 'Rao', workEmail: 'asha@example.com', departmentId: dept, designationId: desig, joiningDate: '2026-12-01' });
    expect(created.status).toBe(201);
    const newId = created.body.data.id as string;

    // Step 2 fails (storage outage): the employee exists, no document, no stray files; a retry succeeds.
    storage.failPutAt = 1;
    expect((await submit('hr', newId)).status).toBe(503);
    expect((await get('hr', base(newId))).body).toEqual({ data: null });
    expect(storage.objects.size).toBe(0);
    storage.failPutAt = null;
    storage.puts = 0;
    const retry = await submit('hr', newId);
    expect(retry.status).toBe(201);
    expect((await get('hr', base(newId))).body.data.documentType).toBe('AADHAAR');
    // The employee record, number and onboarding were created by the unchanged employee endpoint.
    expect((await h.api('hr', 'get', `/employees/${newId}`)).body.data.employeeNumber).toMatch(/^EMP-/);
  });
});

describe('audit trail never contains sensitive values', () => {
  it('no number, last four, storage key or link in any identity audit row', async () => {
    await submit('hr', emp('team'));
    await get('hr', base(emp('team')));
    await get('hr', `${base(emp('team'))}/front/link`);
    await post('sa', `${base(emp('team'))}/reveal`);
    await submit('team', emp('team'), { fields: { documentType: 'PAN', documentNumber: PAN, consent: 'true' }, back: null });
    await del('hr', base(emp('team')));
    const all = await audits();
    expect(all.map((a) => a.action)).toEqual([
      'identity_document.uploaded',
      'identity_document.metadata_viewed',
      'identity_document.viewed',
      'identity_document.number_revealed',
      'identity_document.replaced',
      'identity_document.deleted',
    ]);
    const [first] = await rows(emp('team'));
    const text = JSON.stringify(all);
    for (const secret of [AADHAAR, AADHAAR.slice(-4), PAN, '234F', first.frontPath, 'storage.test']) expect(text).not.toContain(secret);
    for (const a of all) {
      expect(a.actorId).toBeTruthy();
      expect(a.newValue.employeeId).toBe(emp('team'));
      expect(a.createdAt).toBeInstanceOf(Date);
    }
  });
});
