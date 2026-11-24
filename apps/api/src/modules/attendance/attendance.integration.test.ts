/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import pg from 'pg';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attendanceOverviewResponseSchema, manualAttendanceCorrectionResponseSchema } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { Harness, id } from '../../test/integration/api-harness';

/**
 * Attendance against REAL PostgreSQL (scratch database): ATT-002 (409), ATT-004 (overview), ATT-005 (7-day
 * window), ATT-006 (review scope), ATT-007 (HR manual correction), for all four roles and two companies.
 * The clock is injected: "now" is Wednesday 2026-11-18 10:00 UTC (company work end 18:00).
 */

// `timestamp without time zone` columns hold UTC (Prisma); read them back as UTC, not the machine's zone.
pg.types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

const A = id();
const B = id();
let now = new Date('2026-11-18T10:00:00.000Z');

let admin: pg.Client;
let h: Harness;
let disconnect: () => Promise<void>;

beforeAll(async () => {
  const testAppUrl = testUrl('TEST_DATABASE_URL');
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testAppUrl;
  const { createApp } = await import('../../app');
  const { DevAuthProvider } = await import('../../integrations/central-auth/dev.provider');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB);
  h = new Harness(admin, A, B);
  h.app = createApp({ authProvider: new DevAuthProvider(A), clock: () => now }) as Express;
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

const emp = (k: string) => h.people[k]!.emp;
// Sessions are created on first use (password hashing makes eager logins of every person slow).
const api = async (who: string, method: 'get' | 'post' | 'patch', url: string, body?: unknown) => {
  if (!h.sessions[who]) await h.login(who);
  return h.api(who, method, url, body);
};
const iso = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;
let DEPT_ENG = '';
let DEPT_OPS = '';

beforeEach(async () => {
  now = new Date('2026-11-18T10:00:00.000Z');
  await h.reset();
  DEPT_ENG = id();
  DEPT_OPS = id();
  await admin.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now()),($3,$2,'Operations',now())`, [DEPT_ENG, A, DEPT_OPS]);
  // sa -> hr ; sa -> mgr -> team -> sub (indirect report of mgr) ; sa -> peer ; company B: hrb, empb
  await h.seedPerson(A, 'sa', 'SUPER_ADMIN');
  await h.seedPerson(A, 'hr', 'HR_ADMIN', 'sa');
  await h.seedPerson(A, 'mgr', 'MANAGER', 'sa', { departmentId: DEPT_ENG });
  await h.seedPerson(A, 'team', 'EMPLOYEE', 'mgr', { departmentId: DEPT_ENG });
  await h.seedPerson(A, 'sub', 'EMPLOYEE', 'team', { departmentId: DEPT_OPS });
  await h.seedPerson(A, 'peer', 'EMPLOYEE', 'sa', { departmentId: DEPT_OPS });
  await h.seedPerson(B, 'hrb', 'HR_ADMIN');
  await h.seedPerson(B, 'empb', 'EMPLOYEE');
});

const record = async (who: string, day: string) => (await admin.query(`SELECT * FROM hr.attendance_records WHERE "employeeId"=$1 AND date=$2`, [emp(who), day])).rows;
const audit = async (action: string) => (await admin.query(`SELECT * FROM hr.audit_logs WHERE action=$1 ORDER BY "createdAt"`, [action])).rows;
const correction = (who: string, day: string, reason = 'forgot to punch') =>
  api(who, 'post', '/attendance/corrections', { date: day, proposedCheckInAt: iso(day, '09:00'), proposedCheckOutAt: iso(day, '17:30'), reason });

describe('ATT-002: duplicate check-in returns 409', () => {
  it('first check-in 201, second 409, and only one record exists', async () => {
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(201);
    const again = await api('team', 'post', '/attendance/check-in');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONFLICT');
    expect(await record('team', '2026-11-18')).toHaveLength(1);
  });

  it('two simultaneous check-ins: exactly one succeeds, the other is 409', async () => {
    const results = await Promise.all([api('sub', 'post', '/attendance/check-in'), api('sub', 'post', '/attendance/check-in')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await record('sub', '2026-11-18')).toHaveLength(1);
  });

  it('every role can check in once for themselves; a second attempt is 409', async () => {
    for (const who of ['sa', 'hr', 'mgr', 'empb']) expect((await api(who, 'post', '/attendance/check-in')).status, who).toBe(201);
    expect((await api('hr', 'post', '/attendance/check-in')).status).toBe(409);
  });

  it('a non-working day and a holiday are still refused (400), not 409', async () => {
    now = new Date('2026-11-14T10:00:00.000Z'); // Saturday
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(400);
    now = new Date('2026-11-18T10:00:00.000Z');
    await admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ($1,$2,'2026-11-18','Founders Day',now())`, [id(), A]);
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(400);
  });
});

describe('ATT-005: correction requests and the seven-day window (enforced by the API)', () => {
  it('accepts today, today-1 and exactly today-7', async () => {
    for (const day of ['2026-11-18', '2026-11-17', '2026-11-11']) expect((await correction('team', day)).status, day).toBe(201);
  });

  it('rejects today-8 with 400 CORRECTION_WINDOW_EXPIRED and creates nothing', async () => {
    const res = await correction('team', '2026-11-10');
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('CORRECTION_WINDOW_EXPIRED');
    expect((await admin.query(`SELECT 1 FROM hr.attendance_corrections`)).rowCount).toBe(0);
  });

  it('rejects a future date with 400 CORRECTION_DATE_IN_FUTURE', async () => {
    const res = await correction('team', '2026-11-19');
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('CORRECTION_DATE_IN_FUTURE');
  });

  it('the window boundary moves at the COMPANY midnight (Asia/Kolkata: 18:30 UTC), not at UTC midnight', async () => {
    now = new Date('2026-11-18T18:29:59.000Z'); // still 2026-11-18 in Kolkata
    expect((await correction('team', '2026-11-11')).status).toBe(201); // today-7
    now = new Date('2026-11-18T18:30:00.000Z'); // 2026-11-19 in Kolkata: 2026-11-11 is now 8 days old
    const old = await correction('sub', '2026-11-11');
    expect(old.status).toBe(400);
    expect(old.body.error.details.code).toBe('CORRECTION_WINDOW_EXPIRED');
    expect((await correction('sub', '2026-11-12')).status).toBe(201);
    expect((await correction('peer', '2026-11-19')).status).toBe(201); // "today" locally, tomorrow in UTC
    expect((await correction('mgr', '2026-11-20')).status).toBe(400); // really in the future
  });

  it('a second pending request for the same date is 409; a different date is fine', async () => {
    expect((await correction('team', '2026-11-17')).status).toBe(201);
    expect((await correction('team', '2026-11-17')).status).toBe(409);
    expect((await correction('team', '2026-11-16')).status).toBe(201);
  });

  it('the database enforces one pending request per employee and date: the partial unique index exists', async () => {
    const idx = (await admin.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='hr' AND indexname='attendance_corrections_one_pending_key'`)).rows;
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/UNIQUE/);
    expect(idx[0].indexdef).toMatch(/\("companyId", "employeeId", date\)/);
    expect(idx[0].indexdef).toMatch(/WHERE.*status.*PENDING/);
  });

  it('simultaneous duplicate requests: exactly one is created, the others are 409, and only one PENDING row exists', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => correction('peer', '2026-11-17')));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await admin.query(`SELECT count(*)::int n FROM hr.attendance_corrections WHERE "employeeId"=$1 AND status='PENDING'`, [emp('peer')])).rows[0].n).toBe(1);
  });

  it('a rejected request frees the date: the employee can file again, and a decided request does not block a new one', async () => {
    const first = await correction('team', '2026-11-17');
    expect((await api('hr', 'patch', `/attendance/corrections/${first.body.data.id}/review`, { status: 'REJECTED', comment: 'no' })).status).toBe(200);
    expect((await correction('team', '2026-11-17')).status).toBe(201);
    expect((await admin.query(`SELECT count(*)::int n FROM hr.attendance_corrections WHERE "employeeId"=$1`, [emp('team')])).rows[0].n).toBe(2);
  });

  it('the request is always filed for the caller: a body employeeId is rejected (strict schema)', async () => {
    const res = await api('team', 'post', '/attendance/corrections', { employeeId: emp('peer'), date: '2026-11-17', proposedCheckInAt: iso('2026-11-17', '09:00'), proposedCheckOutAt: iso('2026-11-17', '17:00'), reason: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Correction review and visibility (ATT-006) by role and reporting scope', () => {
  it("an Employee cannot list others' corrections or review anything", async () => {
    const created = await correction('team', '2026-11-17');
    await correction('peer', '2026-11-17');
    const list = await api('sub', 'get', '/attendance/corrections');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const own = await api('team', 'get', '/attendance/corrections');
    expect(own.body.data.map((c: any) => c.employeeId)).toEqual([emp('team')]);
    expect((await api('peer', 'patch', `/attendance/corrections/${created.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('team', 'patch', `/attendance/corrections/${created.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
  });

  it('a Manager lists only own + team (direct and indirect) and no one else', async () => {
    await correction('team', '2026-11-17');
    await correction('sub', '2026-11-17'); // indirect report
    await correction('peer', '2026-11-17'); // not in mgr's team
    await correction('mgr', '2026-11-17');
    const list = await api('mgr', 'get', '/attendance/corrections');
    expect(list.body.data.map((c: any) => c.employeeId).sort()).toEqual([emp('team'), emp('sub'), emp('mgr')].sort());
  });

  it('a Manager reviews a direct and an indirect report, not a peer, not themselves', async () => {
    const t = await correction('team', '2026-11-17');
    const s = await correction('sub', '2026-11-17');
    const p = await correction('peer', '2026-11-17');
    const m = await correction('mgr', '2026-11-17');
    expect((await api('mgr', 'patch', `/attendance/corrections/${t.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await api('mgr', 'patch', `/attendance/corrections/${s.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await api('mgr', 'patch', `/attendance/corrections/${p.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('mgr', 'patch', `/attendance/corrections/${m.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect(await record('peer', '2026-11-17')).toHaveLength(0);
  });

  it('HR sees and reviews everyone but never their own request; Super Admin likewise; rejection needs a comment', async () => {
    const own = await correction('hr', '2026-11-17');
    const saOwn = await correction('sa', '2026-11-17');
    const peer = await correction('peer', '2026-11-17');
    expect((await api('hr', 'patch', `/attendance/corrections/${own.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('sa', 'patch', `/attendance/corrections/${saOwn.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('hr', 'patch', `/attendance/corrections/${saOwn.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await api('sa', 'patch', `/attendance/corrections/${own.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await api('hr', 'patch', `/attendance/corrections/${peer.body.data.id}/review`, { status: 'REJECTED' })).status).toBe(400);
    expect((await api('hr', 'patch', `/attendance/corrections/${peer.body.data.id}/review`, { status: 'REJECTED', comment: 'no evidence' })).status).toBe(200);
    expect((await api('hr', 'get', '/attendance/corrections')).body.data.length).toBe(3);
  });

  it('approval writes the record, keeps the originals and an audit row; a second review is 409', async () => {
    await admin.query(`INSERT INTO hr.attendance_records (id,"companyId","employeeId",date,"checkInAt","updatedAt") VALUES ($1,$2,$3,'2026-11-17',$4,now())`, [id(), A, emp('team'), iso('2026-11-17', '10:15')]);
    const c = await correction('team', '2026-11-17');
    expect((await api('hr', 'patch', `/attendance/corrections/${c.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
    const [rec] = await record('team', '2026-11-17');
    expect(new Date(rec.checkInAt).toISOString()).toBe(iso('2026-11-17', '09:00'));
    expect(new Date(rec.originalCheckInAt).toISOString()).toBe(iso('2026-11-17', '10:15'));
    expect(rec.lastCorrectedByUserId).toBe(h.people.hr!.user);
    const [a] = await audit('attendance.correction_approved');
    expect(a.actorId).toBe(h.people.hr!.user);
    expect(new Date(a.oldValue.checkInAt).toISOString()).toBe(iso('2026-11-17', '10:15'));
    expect((await api('hr', 'patch', `/attendance/corrections/${c.body.data.id}/review`, { status: 'REJECTED', comment: 'again' })).status).toBe(409);
  });

  it('cross-tenant: company B HR can neither see nor review company A corrections (404), and sees none', async () => {
    const c = await correction('team', '2026-11-17');
    expect((await api('hrb', 'patch', `/attendance/corrections/${c.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(404);
    expect((await api('hrb', 'get', '/attendance/corrections')).body.data).toHaveLength(0);
    expect((await admin.query(`SELECT status FROM hr.attendance_corrections WHERE id=$1`, [c.body.data.id])).rows[0].status).toBe('PENDING');
  });
});

describe('History scope', () => {
  it('Manager sees indirect reports but not peers; Employee only self; HR anyone in the company; other company sees nothing', async () => {
    expect((await api('mgr', 'get', `/attendance/history?employeeId=${emp('sub')}`)).status).toBe(200);
    expect((await api('mgr', 'get', `/attendance/history?employeeId=${emp('peer')}`)).status).toBe(403);
    expect((await api('team', 'get', `/attendance/history?employeeId=${emp('sub')}`)).status).toBe(403);
    expect((await api('team', 'get', '/attendance/history')).status).toBe(200);
    expect((await api('hr', 'get', `/attendance/history?employeeId=${emp('peer')}`)).status).toBe(200);
    const cross = await api('hrb', 'get', `/attendance/history?employeeId=${emp('peer')}`);
    expect(cross.body.data ?? []).toHaveLength(0);
  });
});

describe('ATT-007: HR manual correction', () => {
  const manual = (who: string, body: Record<string, unknown>) => api(who, 'post', '/attendance/manual-corrections', body);

  it('HR creates a missing record: values stored, who/when/why recorded, audit row written', async () => {
    const res = await manual('hr', { employeeId: emp('team'), date: '2026-11-16', checkInAt: iso('2026-11-16', '09:00'), checkOutAt: iso('2026-11-16', '17:00'), reason: 'Kiosk was down' });
    expect(res.status).toBe(200);
    expect(manualAttendanceCorrectionResponseSchema.safeParse(res.body).success).toBe(true); // the response honours the shared contract
    expect(res.body.data.workedMinutes).toBe(480);
    const [rec] = await record('team', '2026-11-16');
    expect(rec.correctionReason).toBe('Kiosk was down');
    expect(rec.lastCorrectedByUserId).toBe(h.people.hr!.user);
    expect(new Date(rec.lastCorrectedAt).toISOString()).toBe(now.toISOString());
    const [a] = await audit('attendance.manual_correction');
    expect(a.actorId).toBe(h.people.hr!.user);
    expect(a.oldValue).toBeNull();
    expect(a.newValue.reason).toBe('Kiosk was down');
    expect(new Date(a.newValue.checkInAt).toISOString()).toBe(iso('2026-11-16', '09:00'));
  });

  it('a second correction keeps the very first original and audits both old and new values', async () => {
    const day = '2026-11-16';
    await admin.query(`INSERT INTO hr.attendance_records (id,"companyId","employeeId",date,"checkInAt","checkOutAt","workedMinutes","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,420,now())`, [id(), A, emp('team'), day, iso(day, '10:00'), iso(day, '17:00')]);
    expect((await manual('hr', { employeeId: emp('team'), date: day, checkInAt: iso(day, '09:30'), reason: 'late badge' })).status).toBe(200);
    expect((await manual('sa', { employeeId: emp('team'), date: day, checkOutAt: iso(day, '18:00'), reason: 'left later' })).status).toBe(200);
    const [rec] = await record('team', day);
    expect(new Date(rec.originalCheckInAt).toISOString()).toBe(iso(day, '10:00'));
    expect(new Date(rec.originalCheckOutAt).toISOString()).toBe(iso(day, '17:00'));
    expect(new Date(rec.checkInAt).toISOString()).toBe(iso(day, '09:30'));
    expect(rec.workedMinutes).toBe(510);
    expect(rec.lastCorrectedByUserId).toBe(h.people.sa!.user);
    const rows = await audit('attendance.manual_correction');
    expect(rows).toHaveLength(2);
    expect(new Date(rows[1].oldValue.checkInAt).toISOString()).toBe(iso(day, '09:30'));
    expect(new Date(rows[1].newValue.checkOutAt).toISOString()).toBe(iso(day, '18:00'));
  });

  it('is allowed beyond seven days (the window applies to employee requests, not HR)', async () => {
    expect((await manual('hr', { employeeId: emp('team'), date: '2026-10-01', checkInAt: iso('2026-10-01', '09:00'), checkOutAt: iso('2026-10-01', '17:00'), reason: 'month-end audit' })).status).toBe(200);
  });

  it('only HR Admin and Super Admin: Manager and Employee get 403 and nothing is written', async () => {
    const body = { employeeId: emp('team'), date: '2026-11-16', checkInAt: iso('2026-11-16', '09:00'), reason: 'x' };
    for (const who of ['mgr', 'team', 'sub', 'peer']) expect((await manual(who, body)).status, who).toBe(403);
    expect((await admin.query(`SELECT 1 FROM hr.attendance_records`)).rowCount).toBe(0);
    expect(await audit('attendance.manual_correction')).toHaveLength(0);
  });

  it('cross-tenant: company B HR cannot correct a company A employee (404), and A cannot reach B', async () => {
    const body = { employeeId: emp('team'), date: '2026-11-16', checkInAt: iso('2026-11-16', '09:00'), reason: 'x' };
    expect((await manual('hrb', body)).status).toBe(404);
    expect((await manual('hr', { ...body, employeeId: emp('empb') })).status).toBe(404);
    expect((await admin.query(`SELECT 1 FROM hr.attendance_records`)).rowCount).toBe(0);
  });

  it('nobody corrects their own attendance this way (403); HR can correct the Super Admin', async () => {
    const day = '2026-11-16';
    expect((await manual('hr', { employeeId: emp('hr'), date: day, checkInAt: iso(day, '09:00'), reason: 'x' })).status).toBe(403);
    expect((await manual('sa', { employeeId: emp('sa'), date: day, checkInAt: iso(day, '09:00'), reason: 'x' })).status).toBe(403);
    expect((await manual('hr', { employeeId: emp('sa'), date: day, checkInAt: iso(day, '09:00'), reason: 'ok' })).status).toBe(200);
  });

  it('validation: future date, bad order, check-out without check-in, nothing to change, missing reason, unknown field', async () => {
    const day = '2026-11-16';
    const base = { employeeId: emp('team'), date: day, reason: 'x' };
    expect((await manual('hr', { ...base, date: '2026-11-19', checkInAt: iso('2026-11-19', '09:00') })).status).toBe(400);
    expect((await manual('hr', { ...base, checkInAt: iso(day, '17:00'), checkOutAt: iso(day, '09:00') })).status).toBe(400);
    expect((await manual('hr', { ...base, checkOutAt: iso(day, '17:00') })).status).toBe(400); // no existing check-in
    expect((await manual('hr', { ...base })).status).toBe(400); // no times at all
    expect((await manual('hr', { ...base, checkInAt: null })).status).toBe(400); // clearing a record that does not exist
    expect((await manual('hr', { employeeId: emp('team'), date: day, checkInAt: iso(day, '09:00') })).status).toBe(400); // reason missing
    expect((await manual('hr', { ...base, checkInAt: iso(day, '09:00'), status: 'PRESENT' })).status).toBe(400); // unknown field
    expect((await manual('hr', { ...base, checkInAt: 'yesterday' })).status).toBe(400);
    expect((await manual('hr', { ...base, employeeId: 'not-a-uuid', checkInAt: iso(day, '09:00') })).status).toBe(400);
    expect((await manual('hr', { ...base, employeeId: id(), checkInAt: iso(day, '09:00') })).status).toBe(404);
    expect((await manual('hr', { ...base, date: '2026-11-18', checkInAt: iso('2026-11-18', '11:00') })).status).toBe(400); // check-in later than "now"
    expect((await admin.query(`SELECT 1 FROM hr.attendance_records`)).rowCount).toBe(0);
  });

  it('conflicts: identical values 409; pending employee request on that date 409; terminated employee 400', async () => {
    const day = '2026-11-16';
    const body = { employeeId: emp('team'), date: day, checkInAt: iso(day, '09:00'), checkOutAt: iso(day, '17:00'), reason: 'x' };
    expect((await manual('hr', body)).status).toBe(200);
    expect((await manual('hr', body)).status).toBe(409);
    await correction('sub', day);
    expect((await manual('hr', { ...body, employeeId: emp('sub') })).status).toBe(409);
    await admin.query(`UPDATE hr.employees SET status='TERMINATED', "terminationDate"='2026-11-01', "exitDate"='2026-11-01' WHERE id=$1`, [emp('peer')]);
    expect((await manual('hr', { ...body, employeeId: emp('peer') })).status).toBe(400);
  });

  it('clearing a check-out is allowed and recalculates; the corrected values show in history', async () => {
    const day = '2026-11-16';
    await manual('hr', { employeeId: emp('team'), date: day, checkInAt: iso(day, '09:00'), checkOutAt: iso(day, '17:00'), reason: 'seed' });
    const res = await manual('hr', { employeeId: emp('team'), date: day, checkOutAt: null, reason: 'left no punch' });
    expect(res.status).toBe(200);
    expect(res.body.data.checkOutAt).toBeNull();
    expect(res.body.data.workedMinutes).toBeNull();
    const hist = await api('hr', 'get', `/attendance/history?employeeId=${emp('team')}&from=${day}&to=${day}`);
    expect(hist.body.data[0].checkOutAt).toBeNull();
  });
});

describe('ATT-004: HR attendance overview by date', () => {
  const overview = (who: string, qs: string) => api(who, 'get', `/attendance/overview?${qs}`);
  const seedRecord = (who: string, day: string, inHm: string | null, outHm: string | null) =>
    admin.query(`INSERT INTO hr.attendance_records (id,"companyId","employeeId",date,"checkInAt","checkOutAt","workedMinutes","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [id(), A, emp(who), day, inHm ? iso(day, inHm) : null, outHm ? iso(day, outHm) : null, inHm && outHm ? 480 : null]);
  const leaveType = async () => {
    const lt = id();
    await admin.query(`INSERT INTO hr.leave_types (id,"companyId",name,"annualAllocation","isPaid","allowHalfDay","isActive","updatedAt") VALUES ($1,$2,'Casual',12,true,true,true,now())`, [lt, A]);
    return lt;
  };
  const statusOf = (res: any, who: string) => res.body.data.find((r: any) => r.employeeId === emp(who))?.status;

  it('only HR Admin and Super Admin; Manager and Employee get 403', async () => {
    for (const who of ['mgr', 'team']) expect((await overview(who, 'date=2026-11-17')).status, who).toBe(403);
    expect((await overview('hr', 'date=2026-11-17')).status).toBe(200);
    expect((await overview('sa', 'date=2026-11-17')).status).toBe(200);
  });

  it('a past working day: present, missing check-out, on leave and absent are told apart', async () => {
    const day = '2026-11-17'; // Tuesday
    await seedRecord('team', day, '09:00', '17:00');
    await seedRecord('sub', day, '09:00', null);
    const lt = await leaveType();
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate","dayType",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$5,'FULL_DAY','x',1,'APPROVED',now())`, [id(), A, emp('peer'), lt, day]);
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate","dayType",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$5,'FULL_DAY','x',1,'PENDING',now())`, [id(), A, emp('mgr'), lt, day]);
    const res = await overview('hr', `date=${day}&pageSize=100`);
    expect(attendanceOverviewResponseSchema.safeParse(res.body).success).toBe(true); // the response honours the shared contract
    expect(statusOf(res, 'team')).toBe('PRESENT');
    expect(statusOf(res, 'sub')).toBe('MISSING_CHECKOUT');
    expect(statusOf(res, 'peer')).toBe('ON_LEAVE');
    expect(statusOf(res, 'mgr')).toBe('ABSENT'); // pending leave is not leave
    expect(statusOf(res, 'sa')).toBe('ABSENT');
    expect(res.body.meta).toMatchObject({ date: day, isWorkingDay: true, isHoliday: false });
    expect(res.body.summary).toMatchObject({ PRESENT: 1, MISSING_CHECKOUT: 1, ON_LEAVE: 1, ABSENT: 3 });
  });

  it('today before work end: nobody without a check-in is ABSENT (NOT_YET_IN); after work end they are', async () => {
    await seedRecord('team', '2026-11-18', '09:00', null);
    let res = await overview('hr', 'date=2026-11-18&pageSize=100');
    expect(statusOf(res, 'team')).toBe('PRESENT');
    expect(statusOf(res, 'sub')).toBe('NOT_YET_IN');
    expect(res.body.summary.ABSENT).toBe(0);
    now = new Date('2026-11-18T18:30:00.000Z');
    res = await overview('hr', 'date=2026-11-18&pageSize=100');
    expect(statusOf(res, 'sub')).toBe('ABSENT');
    expect(statusOf(res, 'team')).toBe('MISSING_CHECKOUT');
  });

  it('weekends and holidays are not absences; a worked weekend is still PRESENT', async () => {
    let res = await overview('hr', 'date=2026-11-14&pageSize=100'); // Saturday
    expect(res.body.meta.isWorkingDay).toBe(false);
    expect(res.body.data.every((r: any) => r.status === 'WEEKEND')).toBe(true);
    await seedRecord('team', '2026-11-14', '10:00', '14:00');
    res = await overview('hr', 'date=2026-11-14&pageSize=100');
    expect(statusOf(res, 'team')).toBe('PRESENT');
    await admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ($1,$2,'2026-11-16','Diwali',now())`, [id(), A]);
    res = await overview('hr', 'date=2026-11-16&pageSize=100');
    expect(res.body.meta).toMatchObject({ isHoliday: true, holidayName: 'Diwali' });
    expect(res.body.data.every((r: any) => r.status === 'HOLIDAY')).toBe(true);
  });

  it('half-day leave is flagged but does not turn the day into leave', async () => {
    const day = '2026-11-17';
    const lt = await leaveType();
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate","dayType","halfDaySession",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$5,'HALF_DAY','FIRST_HALF','x',0.5,'APPROVED',now())`, [id(), A, emp('team'), lt, day]);
    await seedRecord('team', day, '13:00', '18:00');
    const res = await overview('hr', `date=${day}&pageSize=100`);
    const row = res.body.data.find((r: any) => r.employeeId === emp('team'));
    expect(row.status).toBe('PRESENT');
    expect(row.halfDayLeave).toBe(true);
  });

  it('future dates are rejected; terminated employees and other companies never appear', async () => {
    expect((await overview('hr', 'date=2026-11-19')).status).toBe(400);
    await admin.query(`UPDATE hr.employees SET status='TERMINATED', "terminationDate"='2026-11-01', "exitDate"='2026-11-01' WHERE id=$1`, [emp('peer')]);
    const res = await overview('hr', 'date=2026-11-17&pageSize=100');
    const ids = res.body.data.map((r: any) => r.employeeId);
    expect(ids).not.toContain(emp('peer'));
    expect(ids).not.toContain(emp('empb'));
    expect(ids).not.toContain(emp('hrb'));
    expect(res.body.page.total).toBe(5);
    const other = await overview('hrb', 'date=2026-11-17&pageSize=100');
    expect(other.body.data.map((r: any) => r.employeeId).sort()).toEqual([emp('empb'), emp('hrb')].sort());
  });

  it('paginates, filters by status, department and search, with a summary over all matches', async () => {
    const day = '2026-11-17';
    await seedRecord('team', day, '09:00', '17:00');
    const p1 = await overview('hr', `date=${day}&pageSize=2&page=1`);
    const p3 = await overview('hr', `date=${day}&pageSize=2&page=3`);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.page).toEqual({ page: 1, pageSize: 2, total: 6 });
    expect(p3.body.data).toHaveLength(2);
    expect(p1.body.summary.PRESENT).toBe(1); // summary covers all 6, not just the page
    const seen = new Set<string>();
    for (const p of [1, 2, 3]) for (const r of (await overview('hr', `date=${day}&pageSize=2&page=${p}`)).body.data) seen.add(r.employeeId);
    expect(seen.size).toBe(6);
    expect((await overview('hr', `date=${day}&status=PRESENT`)).body.data.map((r: any) => r.employeeId)).toEqual([emp('team')]);
    const eng = await overview('hr', `date=${day}&departmentId=${DEPT_ENG}&pageSize=100`);
    expect(eng.body.data.map((r: any) => r.employeeId).sort()).toEqual([emp('mgr'), emp('team')].sort());
    expect(eng.body.data[0].departmentName).toBe('Engineering');
    expect((await overview('hr', `date=${day}&search=SUB`)).body.data.map((r: any) => r.employeeId)).toEqual([emp('sub')]);
    expect((await overview('hr', `date=${day}&pageSize=101`)).status).toBe(400);
    expect((await overview('hr', 'date=17-11-2026')).status).toBe(400);
  });
});

describe('company time zone decides the attendance day (not the UTC date)', () => {
  it('a check-in at 20:00 UTC by a Kolkata company is stored on the NEXT calendar date and shown by /today', async () => {
    now = new Date('2026-11-18T20:00:00.000Z'); // 01:30 on 2026-11-19 in Kolkata (a Thursday: working day)
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(201);
    expect(await record('team', '2026-11-19')).toHaveLength(1);
    expect(await record('team', '2026-11-18')).toHaveLength(0);
    const today = await api('team', 'get', '/attendance/today');
    expect(today.body.data.date).toBe('2026-11-19');
    expect(today.body.data.state).toBe('CHECKED_IN');
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(409);
    now = new Date('2026-11-18T22:00:00.000Z');
    expect((await api('team', 'post', '/attendance/check-out')).status).toBe(200);
  });

  it('the same instant in a UTC company is still the earlier date (companies are independent)', async () => {
    now = new Date('2026-11-18T20:00:00.000Z');
    expect((await api('empb', 'post', '/attendance/check-in')).status).toBe(201);
    expect(await record('empb', '2026-11-18')).toHaveLength(1);
  });

  it('the working-day rule uses the company day: Friday 20:00 UTC is Saturday in Kolkata, so check-in is refused', async () => {
    now = new Date('2026-11-13T20:00:00.000Z'); // Friday UTC, Saturday 01:30 local
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(400);
  });

  it('the overview treats the local date as today: the UTC date is "yesterday" and complete, the local date is not over yet', async () => {
    now = new Date('2026-11-18T20:00:00.000Z'); // 2026-11-19 01:30 local
    const local = await api('hr', 'get', '/attendance/overview?date=2026-11-19&pageSize=100');
    expect(local.status).toBe(200); // accepted: it is today locally (was "future" under UTC)
    expect(local.body.data.every((r: any) => r.status === 'NOT_YET_IN')).toBe(true);
    const previous = await api('hr', 'get', '/attendance/overview?date=2026-11-18&pageSize=100');
    expect(previous.body.data.every((r: any) => r.status === 'ABSENT')).toBe(true);
    expect((await api('hr', 'get', '/attendance/overview?date=2026-11-20')).status).toBe(400);
  });

  it('the dashboard counts check-ins on the same company day', async () => {
    // The dashboard has no injectable clock, so use the real one: the check-in and the dashboard must agree on "today".
    now = new Date();
    const first = await api('team', 'post', '/attendance/check-in');
    if (first.status === 400) return; // the real "today" is not a working day for the company's calendar; nothing to compare
    expect(first.status).toBe(201);
    const dash = await api('hr', 'get', '/dashboard/hr');
    expect(dash.status).toBe(200);
    expect(dash.body.data.presentToday).toBe(1);
    const emp = await api('team', 'get', '/dashboard/employee');
    expect(emp.body.data.attendanceState.action).toBe('CHECK_OUT');
  });
});
