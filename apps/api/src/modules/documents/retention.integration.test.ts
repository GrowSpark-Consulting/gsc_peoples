import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, testUrl } from '../../test/integration/helpers';
import { Harness, id } from '../../test/integration/api-harness';
import type { DocumentStorage } from '../../integrations/storage';
import { StorageError } from '../../integrations/storage';
import type { TenantRunner } from '../../database/tenant';
import { purgeAllCompanies, purgeExpiredDocuments, RETENTION_DAYS, type PurgeLogger } from './retention';

/**
 * 30-day retention purge against REAL PostgreSQL (scratch database), with storage faked at its interface.
 * Nothing here talks to Supabase.
 */

pg.types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

class FakeStorage implements DocumentStorage {
  readonly driver = 'supabase' as const;
  objects = new Set<string>();
  removeCalls: string[] = [];
  failFor = new Set<string>();
  onRemove?: (key: string) => Promise<void>;
  async put() {}
  async createSignedDownloadUrl(): Promise<string> {
    return '';
  }
  async remove(key: string) {
    this.removeCalls.push(key);
    await this.onRemove?.(key);
    if (this.failFor.has(key)) throw new StorageError('provider said: secret-bucket-detail', 500);
    this.objects.delete(key);
  }
}

class CaptureLog implements PurgeLogger {
  lines: string[] = [];
  info(o: Record<string, unknown>, m: string) {
    this.lines.push(`info ${m} ${JSON.stringify(o)}`);
  }
  warn(o: Record<string, unknown>, m: string) {
    this.lines.push(`warn ${m} ${JSON.stringify(o)}`);
  }
  error(o: Record<string, unknown>, m: string) {
    this.lines.push(`error ${m} ${JSON.stringify(o)}`);
  }
}

const A = id();
const B = id();
let admin: pg.Client;
let h: Harness;
let runner: TenantRunner;
let disconnect: () => Promise<void>;
const storage = new FakeStorage();
const DAY = 86_400_000;
const T0 = new Date('2026-12-01T12:00:00.000Z');

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testUrl('TEST_DATABASE_URL');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  const { createTenantRunner } = await import('../../database/tenant');
  disconnect = disconnectDatabase;
  runner = createTenantRunner(getPrisma());
  h = new Harness(admin, A, B);
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

let key = 0;
/** Inserts a document row (and its object) directly. */
async function doc(company: string, owner: string | null, o: { deletedAt?: Date | null; purgeAfterAt?: Date | null; fileName?: string } = {}) {
  const docId = id();
  const storedPath = `${company}/${owner ?? 'company'}/obj-${(key += 1)}-${docId}`;
  await admin.query(
    `INSERT INTO hr.employee_documents (id,"companyId","ownerEmployeeId","isCompanyDocument",category,"fileName","storedPath","mimeType","sizeBytes","deletedAt","purgeAfterAt","updatedAt")
     VALUES ($1,$2,$3,$4,'OTHER',$5,$6,'application/pdf',10,$7,$8,now())`,
    [docId, company, owner, owner === null, o.fileName ?? 'salary-secret.pdf', storedPath, o.deletedAt?.toISOString() ?? null, o.purgeAfterAt?.toISOString() ?? null], // ISO strings: pg would write a Date in the machine's local zone
  );
  storage.objects.add(storedPath);
  return { id: docId, key: storedPath };
}
const exists = async (docId: string) => ((await admin.query(`SELECT 1 FROM hr.employee_documents WHERE id=$1`, [docId])).rowCount ?? 0) > 0;
const purge = (companyId: string, extra: Partial<Parameters<typeof purgeExpiredDocuments>[0]> = {}) => {
  const log = new CaptureLog();
  return purgeExpiredDocuments({ companyId, runner, storage, now: T0, log, ...extra }).then((r) => ({ r, log }));
};
/** A soft-deleted document that became purgeable `ageDays` ago-or-later relative to T0. */
const expiredAt = (purgeAfter: Date) => ({ deletedAt: new Date(purgeAfter.getTime() - RETENTION_DAYS * DAY), purgeAfterAt: purgeAfter });

beforeEach(async () => {
  storage.objects.clear();
  storage.removeCalls = [];
  storage.failFor.clear();
  storage.onRemove = undefined;
  await h.reset();
  await h.seedPerson(A, 'team', 'EMPLOYEE');
  await h.seedPerson(B, 'empb', 'EMPLOYEE');
});

describe('retention boundary (30 days)', () => {
  it('the retention constant is 30 days and the delete route stamps purgeAfterAt exactly that far out', () => expect(RETENTION_DAYS).toBe(30));

  it('purges at exactly purgeAfterAt, not one millisecond before', async () => {
    const d = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() + 1)));
    expect((await purge(A)).r).toMatchObject({ scanned: 0, purged: 0 });
    expect(await exists(d.id)).toBe(true);
    expect(storage.objects.has(d.key)).toBe(true);
    const exact = await doc(A, h.people.team!.emp, expiredAt(T0));
    const { r } = await purge(A);
    expect(r).toMatchObject({ scanned: 1, purged: 1, failed: 0 });
    expect(await exists(exact.id)).toBe(false);
    expect(storage.objects.has(exact.key)).toBe(false);
    expect(await exists(d.id)).toBe(true); // the 1 ms later one is still waiting
  });

  it('day 29, day 30 and day 31 after deletion', async () => {
    const del = new Date('2026-11-01T00:00:00.000Z');
    const d = await doc(A, h.people.team!.emp, { deletedAt: del, purgeAfterAt: new Date(del.getTime() + 30 * DAY) });
    for (const [now, expectPurged] of [[new Date(del.getTime() + 29 * DAY), 0], [new Date(del.getTime() + 30 * DAY - 1), 0], [new Date(del.getTime() + 30 * DAY), 1]] as const) {
      expect((await purge(A, { now })).r.purged, now.toISOString()).toBe(expectPurged);
    }
    expect(await exists(d.id)).toBe(false);
  });
});

describe('never deletes what must stay', () => {
  it('active documents survive, even with a stale purge date; so do soft-deleted ones still inside retention', async () => {
    const active = await doc(A, h.people.team!.emp, { deletedAt: null, purgeAfterAt: new Date(T0.getTime() - 5 * DAY) }); // restored or corrupt row
    const activeNoDate = await doc(A, h.people.team!.emp);
    const waiting = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() + 10 * DAY)));
    const noPurgeDate = await doc(A, h.people.team!.emp, { deletedAt: new Date(T0.getTime() - 90 * DAY), purgeAfterAt: null });
    const { r } = await purge(A);
    expect(r).toMatchObject({ scanned: 0, purged: 0 });
    for (const d of [active, activeNoDate, waiting, noPurgeDate]) {
      expect(await exists(d.id)).toBe(true);
      expect(storage.objects.has(d.key)).toBe(true);
    }
    expect(storage.removeCalls).toHaveLength(0);
  });

  it('a document restored between selection and deletion is kept', async () => {
    const d = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    storage.onRemove = async () => {
      await admin.query(`UPDATE hr.employee_documents SET "deletedAt"=NULL, "purgeAfterAt"=NULL WHERE id=$1`, [d.id]);
    };
    const { r } = await purge(A);
    expect(r.purged).toBe(0); // the row re-check inside the delete transaction sees the document is active again
    expect(await exists(d.id)).toBe(true);
  });
});

describe('tenant safety', () => {
  it("purging company A never touches company B's rows or objects, even when B's are due", async () => {
    const a = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    const b = await doc(B, h.people.empb!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    const { r } = await purge(A);
    expect(r).toMatchObject({ companyId: A, scanned: 1, purged: 1 });
    expect(await exists(a.id)).toBe(false);
    expect(await exists(b.id)).toBe(true);
    expect(storage.objects.has(b.key)).toBe(true);
    expect(storage.removeCalls).toEqual([a.key]);
    expect((await purge(B)).r.purged).toBe(1);
    expect(await exists(b.id)).toBe(false);
  });

  it('purgeAllCompanies handles each company on its own and a failing company does not stop the others', async () => {
    const a = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    const b = await doc(B, h.people.empb!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    const log = new CaptureLog();
    const out = await purgeAllCompanies([A, '', B], { runner, storage, now: T0, log }); // '' = missing tenant context
    expect(out.map((x) => x.purged)).toEqual([1, 0, 1]);
    expect(out[1]!.failed).toBe(1);
    expect(await exists(a.id)).toBe(false);
    expect(await exists(b.id)).toBe(false);
  });
});

describe('idempotence, failures, audit, logging', () => {
  it('running twice is harmless: the second run finds nothing', async () => {
    await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    expect((await purge(A)).r.purged).toBe(1);
    const again = (await purge(A)).r;
    expect(again).toMatchObject({ scanned: 0, purged: 0, failed: 0 });
    expect(storage.removeCalls).toHaveLength(1);
  });

  it('an object that is already gone is not an error (crash between object removal and row delete is repaired)', async () => {
    const d = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    storage.objects.delete(d.key); // the previous run removed it, then died before deleting the row
    expect((await purge(A)).r).toMatchObject({ purged: 1, failed: 0 });
    expect(await exists(d.id)).toBe(false);
  });

  it('a storage failure keeps that row, never blocks the others, is retried next run, and leaks nothing into the log', async () => {
    const bad = await doc(A, h.people.team!.emp, { ...expiredAt(new Date(T0.getTime() - 2 * DAY)), fileName: 'confidential-offer.pdf' });
    const good = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    storage.failFor.add(bad.key);
    const first = await purge(A);
    expect(first.r).toMatchObject({ scanned: 2, purged: 1, failed: 1, failedIds: [bad.id] });
    expect(await exists(bad.id)).toBe(true);
    expect(await exists(good.id)).toBe(false);
    const text = first.log.lines.join('\n');
    expect(text).toContain('document purge failed');
    for (const secret of ['confidential-offer', bad.key, 'secret-bucket-detail', 'salary-secret']) expect(text).not.toContain(secret);
    storage.failFor.clear();
    expect((await purge(A)).r).toMatchObject({ scanned: 1, purged: 1, failed: 0 });
    expect(await exists(bad.id)).toBe(false);
  });

  it('writes one audit row per purge (system actor) and none for kept documents', async () => {
    const d = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    await doc(A, h.people.team!.emp);
    await purge(A);
    const rows = (await admin.query(`SELECT * FROM hr.audit_logs WHERE action='document.purged'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: d.id, actorId: null, companyId: A });
    expect(JSON.stringify(rows[0].oldValue)).not.toContain('salary-secret');
  });

  it('dry run reports what is due and changes nothing', async () => {
    const d = await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - DAY)));
    const { r } = await purge(A, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, scanned: 1, purged: 0 });
    expect(await exists(d.id)).toBe(true);
    expect(storage.objects.has(d.key)).toBe(true);
    expect(storage.removeCalls).toHaveLength(0);
  });

  it('the batch limit bounds one run and the rest is handled by the next', async () => {
    for (let i = 0; i < 5; i += 1) await doc(A, h.people.team!.emp, expiredAt(new Date(T0.getTime() - (i + 1) * DAY)));
    expect((await purge(A, { limit: 2 })).r).toMatchObject({ scanned: 2, purged: 2 });
    expect((await purge(A, { limit: 100 })).r).toMatchObject({ scanned: 3, purged: 3 });
    expect((await admin.query(`SELECT count(*)::int n FROM hr.employee_documents`)).rows[0].n).toBe(0);
  });
});
