/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  attendanceListResponseSchema,
  attendanceReportResponseSchema,
  auditLogListResponseSchema,
  directoryResponseSchema,
  employeeDashboardResponseSchema,
  hrDashboardResponseSchema,
  leaveBalanceListResponseSchema,
  leaveCalendarResponseSchema,
  leaveRequestListResponseSchema,
  managerDashboardResponseSchema,
  notificationListResponseSchema,
  onboardingProgressListResponseSchema,
} from '@gsc/contracts';
import { createMemoryMailer } from '../../integrations/mail';
import { connect, TEST_DB, testUrl } from './helpers';
import { Harness, id, PASSWORD } from './api-harness';

/**
 * PRD acceptance against REAL PostgreSQL (scratch database), through the real HTTP API with session logins and
 * CSRF: leave rules and concurrency, attendance rules, dashboards, offboarding, invitation and password reset
 * by email, onboarding access, notifications, audit log and tenant isolation.
 * The clock is injected: "now" is Wednesday 2026-11-18 10:00 UTC, 15:30 in the company's zone (Asia/Kolkata),
 * company hours 09:00-18:00, Monday to Friday.
 */
pg.types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));

const A = id();
const B = id();
const mailer = createMemoryMailer();
const MIDDAY = new Date('2026-11-18T10:00:00.000Z');
const EVENING = new Date('2026-11-18T13:00:00.000Z'); // 18:30 local, after work end
let now = MIDDAY;

let admin: pg.Client;
let h: Harness;
let disconnect: () => Promise<void>;
let casual = '';
let dept = '';
let designation = '';

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testUrl('TEST_DATABASE_URL');
  const { createApp } = await import('../../app');
  const { DevAuthProvider } = await import('../../integrations/central-auth/dev.provider');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB);
  h = new Harness(admin, A, B);
  h.app = createApp({ authProvider: new DevAuthProvider(A), clock: () => now, mailer }) as Express;
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

beforeEach(async () => {
  now = MIDDAY;
  mailer.outbox.length = 0;
  await h.reset();
  dept = id();
  designation = id();
  casual = id();
  await admin.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now())`, [dept, A]);
  await admin.query(`INSERT INTO hr.designations (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineer',now())`, [designation, A]);
  await admin.query(`INSERT INTO hr.leave_types (id,"companyId",name,"annualAllocation","updatedAt") VALUES ($1,$2,'Casual',12,now())`, [casual, A]);
  // sa -> hr ; sa -> mgr -> team -> sub (indirect report of mgr) ; sa -> mgr2 -> peer ; company B: hrb, empb
  await h.seedPerson(A, 'sa', 'SUPER_ADMIN');
  await h.seedPerson(A, 'hr', 'HR_ADMIN', 'sa');
  await h.seedPerson(A, 'mgr', 'MANAGER', 'sa', { departmentId: dept });
  await h.seedPerson(A, 'team', 'EMPLOYEE', 'mgr', { departmentId: dept });
  await h.seedPerson(A, 'sub', 'EMPLOYEE', 'team');
  await h.seedPerson(A, 'mgr2', 'MANAGER', 'sa');
  await h.seedPerson(A, 'peer', 'EMPLOYEE', 'mgr2');
  await h.seedPerson(B, 'hrb', 'HR_ADMIN');
  await h.seedPerson(B, 'empb', 'EMPLOYEE');
});

const emp = (k: string) => h.people[k]!.emp;
const user = (k: string) => h.people[k]!.user;
const api = async (who: string, method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: unknown) => {
  if (!h.sessions[who]) await h.login(who);
  return h.api(who, method, url, body);
};
const put = async (who: string, url: string, body: object) => {
  if (!h.sessions[who]) await h.login(who);
  const s = h.sessions[who]!;
  return request(h.app).put(`/api/v1${url}`).set('cookie', s.cookie).set('x-csrf-token', s.csrf).send(body);
};
const q = async <T = any>(sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows as T[];
const apply = (who: string, startDate: string, endDate = startDate, extra: Record<string, unknown> = {}) =>
  api(who, 'post', '/leave/requests', { leaveTypeId: casual, startDate, endDate, reason: 'Family', ...extra });
const review = (who: string, requestId: string, status: 'APPROVED' | 'REJECTED' = 'APPROVED') =>
  api(who, 'patch', `/leave/requests/${requestId}/review`, status === 'REJECTED' ? { status, comment: 'No' } : { status });
const balance = async (who: string, as = who) =>
  leaveBalanceListResponseSchema.parse((await api(as, 'get', `/leave/balances?employeeId=${emp(who)}`)).body).data.find((b) => b.leaveTypeId === casual)!;
const notes = async (who: string) => (await q<{ type: string }>(`select type from hr.notifications where "userId"=$1 order by "createdAt", type`, [user(who)])).map((n) => n.type);
const holiday = (date: string, name = 'Festival') =>
  admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ($1,$2,$3,$4,now())`, [id(), A, date, name]);

describe('leave rules (LEAVE-002 to LEAVE-008)', () => {
  it('counts working days only: weekends and holidays are excluded (LEAVE-003)', async () => {
    await holiday('2026-11-24');
    const res = await apply('team', '2026-11-20', '2026-11-25'); // Fri, [weekend], Mon, [holiday], Wed
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.days).toBe(3);
    expect(await balance('team')).toMatchObject({ allocated: 12, pending: 3, available: 9 });
  });

  it('refuses zero working days, a start more than 7 days back, and a range over two years', async () => {
    expect((await apply('team', '2026-11-21', '2026-11-22')).body.error.details.code).toBe('NO_WORKING_DAYS');
    expect((await apply('team', '2026-11-10')).body.error.details.code).toBe('START_TOO_OLD'); // 8 days back
    expect((await apply('team', '2026-11-11')).status).toBe(201); // exactly 7 days back
    expect((await apply('team', '2026-12-31', '2027-01-04')).body.error.details.code).toBe('SPANS_TWO_YEARS');
  });

  it('refuses overlap and insufficient balance, counting pending days as reserved (LEAVE-004)', async () => {
    expect((await apply('team', '2026-12-01', '2026-12-11')).status).toBe(201); // 9 days
    expect((await apply('team', '2026-12-11')).body.error.message).toMatch(/Overlapping/);
    expect((await apply('team', '2026-12-14', '2026-12-17')).body.error.message).toMatch(/Insufficient/); // 4 > 3
    expect((await apply('team', '2026-12-14', '2026-12-16')).status).toBe(201);
  });

  it('two simultaneous requests cannot both spend the same balance', async () => {
    await admin.query(`update hr.leave_types set "annualAllocation"=3 where id=$1`, [casual]);
    await api('team', 'get', '/leave/types');
    const results = await Promise.all([apply('team', '2026-12-01', '2026-12-02'), apply('team', '2026-12-08', '2026-12-09')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await balance('team')).toMatchObject({ pending: 2, available: 1 });
  });

  it('is decided exactly once: simultaneous approvals deduct the days once (LEAVE-006)', async () => {
    const requestId = (await apply('team', '2026-12-01', '2026-12-02')).body.data.id;
    await api('hr', 'get', '/me');
    await api('sa', 'get', '/me');
    const results = await Promise.all([review('hr', requestId), review('sa', requestId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await balance('team')).toMatchObject({ used: 2, pending: 0, available: 10 });
    expect((await review('mgr', requestId, 'REJECTED')).status).toBe(409);
  });

  it('routes to the reporting manager; indirect managers may decide, others and the applicant may not (LEAVE-005)', async () => {
    const direct = (await apply('team', '2026-12-01')).body.data;
    expect(direct.originalApproverUserId).toBe(user('mgr'));
    expect(await notes('mgr')).toEqual(['LEAVE_REQUESTED']);
    expect((await review('mgr2', direct.id)).status).toBe(403);
    expect((await review('team', direct.id)).status).toBe(403);
    const indirect = (await apply('sub', '2026-12-02')).body.data; // sub -> team (no approval role) -> mgr
    expect((await notes('hr')).includes('LEAVE_REQUESTED')).toBe(true);
    const queue = leaveRequestListResponseSchema.parse((await api('mgr', 'get', '/leave/requests?pendingForMe=true')).body).data.map((r) => r.id).sort();
    expect(queue).toEqual([direct.id, indirect.id].sort());
    expect(leaveRequestListResponseSchema.parse((await api('mgr2', 'get', '/leave/requests?pendingForMe=true')).body).data).toHaveLength(0);
    expect((await review('mgr', indirect.id)).status).toBe(200);
    expect(await notes('sub')).toEqual(['LEAVE_APPROVED']);
  });

  it('sends a Manager\'s own leave to HR, and never lets anyone approve their own', async () => {
    const mine = (await apply('mgr', '2026-12-01')).body.data;
    expect(mine.originalApproverUserId).toBeNull();
    expect((await notes('hr')).filter((t) => t === 'LEAVE_REQUESTED')).toHaveLength(1);
    expect(await notes('sa')).toContain('LEAVE_REQUESTED');
    expect((await review('mgr', mine.id)).status).toBe(403);
    const hrOwn = (await apply('hr', '2026-12-01')).body.data;
    expect((await review('hr', hrOwn.id)).status).toBe(403);
    expect((await review('sa', mine.id)).status).toBe(200);
  });

  it('keeps a pending request with its original approver after a manager change (W9)', async () => {
    const requestId = (await apply('team', '2026-12-01')).body.data.id;
    await admin.query(`update hr.employees set "managerId"=$1 where id=$2`, [emp('mgr2'), emp('team')]);
    expect((await review('mgr2', requestId)).status).toBe(403);
    expect((await review('mgr', requestId)).status).toBe(200);
  });

  it('lets the owner cancel until the start, only HR after it, and restores the balance (LEAVE-007)', async () => {
    const requestId = (await apply('team', '2026-11-19', '2026-11-20')).body.data.id;
    await review('mgr', requestId);
    now = new Date('2026-11-19T06:00:00.000Z'); // the first day of the leave
    expect((await api('team', 'patch', `/leave/requests/${requestId}/cancel`)).status).toBe(403);
    expect((await api('mgr', 'patch', `/leave/requests/${requestId}/cancel`)).status).toBe(403);
    expect((await api('hr', 'patch', `/leave/requests/${requestId}/cancel`)).status).toBe(200);
    expect(await balance('team')).toMatchObject({ used: 0, pending: 0, available: 12 });
    expect(await notes('team')).toEqual(['LEAVE_APPROVED', 'LEAVE_CANCELLED']);
    expect((await api('hr', 'patch', `/leave/requests/${requestId}/cancel`)).status).toBe(409);
  });

  it('notifies each recipient once per event, including rejection and cancellation (NOTIF-002)', async () => {
    const first = (await apply('team', '2026-12-01')).body.data.id;
    await review('mgr', first, 'REJECTED');
    const second = (await apply('team', '2026-12-02')).body.data.id;
    await api('team', 'patch', `/leave/requests/${second}/cancel`);
    expect(await notes('team')).toEqual(['LEAVE_REJECTED']);
    expect(await notes('mgr')).toEqual(['LEAVE_REQUESTED', 'LEAVE_REQUESTED', 'LEAVE_CANCELLED']);
    const feed = notificationListResponseSchema.parse((await api('mgr', 'get', '/notifications')).body);
    expect(feed.unreadCount).toBe(3);
    expect(feed.data.every((n) => n.link === '/leave')).toBe(true);
    await api('mgr', 'patch', '/notifications/read-all');
    expect((await api('mgr', 'get', '/notifications')).body.unreadCount).toBe(0);
    expect((await api('team', 'patch', `/notifications/${feed.data[0]!.id}/read`)).status).toBe(404); // not theirs
  });

  it('adjusting a balance that had no row keeps the annual allocation and is audited (LEAVE-002)', async () => {
    const res = await api('hr', 'post', '/leave/balances/adjust', { employeeId: emp('team'), leaveTypeId: casual, year: 2026, amount: 2, reason: 'carry' });
    expect(res.status).toBe(200);
    expect(await balance('team')).toMatchObject({ allocated: 12, adjusted: 2, available: 14 });
    expect(await q(`select 1 from hr.audit_logs where action='leave.balance_adjusted'`)).toHaveLength(1);
    expect((await api('mgr', 'post', '/leave/balances/adjust', { employeeId: emp('team'), leaveTypeId: casual, year: 2026, amount: 2, reason: 'x' })).status).toBe(403);
    expect((await api('hr', 'post', '/leave/balances/adjust', { employeeId: emp('empb'), leaveTypeId: casual, year: 2026, amount: 2, reason: 'x' })).status).toBe(404);
  });

  it('limits balances to the caller\'s scope', async () => {
    expect((await api('mgr', 'get', `/leave/balances?employeeId=${emp('sub')}`)).status).toBe(200);
    expect((await api('mgr', 'get', `/leave/balances?employeeId=${emp('peer')}`)).status).toBe(403);
    expect((await api('team', 'get', `/leave/balances?employeeId=${emp('peer')}`)).status).toBe(403);
    expect((await api('hrb', 'get', `/leave/balances?employeeId=${emp('team')}`)).status).toBe(404);
  });

  it('shows a month calendar by role with half days marked and holidays named (LEAVE-008)', async () => {
    await holiday('2026-12-03', 'Founders Day');
    await apply('team', '2026-12-02', '2026-12-04');
    await apply('peer', '2026-12-02', '2026-12-02', { dayType: 'HALF_DAY', halfDaySession: 'SECOND_HALF' });
    const read = async (who: string, scope?: string) =>
      leaveCalendarResponseSchema.parse((await api(who, 'get', `/leave/calendar?year=2026&month=12${scope ? `&scope=${scope}` : ''}`)).body);
    const all = await read('hr');
    expect(all.meta.scope).toBe('all');
    expect(all.data).toHaveLength(31);
    const day = (c: typeof all, d: string) => c.data.find((x) => x.date === d)!;
    expect(day(all, '2026-12-02').items.map((i) => [i.employeeName.split(' ')[0], i.dayType])).toEqual(
      expect.arrayContaining([['team', 'FULL_DAY'], ['peer', 'HALF_DAY']]),
    );
    expect(day(all, '2026-12-03')).toMatchObject({ holidayName: 'Founders Day', isWorkingDay: false, items: [] });
    const team = await read('mgr');
    expect(day(team, '2026-12-02').items.map((i) => i.employeeId)).toEqual([emp('team')]);
    expect(day(await read('peer'), '2026-12-02').items.map((i) => i.employeeId)).toEqual([emp('peer')]);
    expect((await api('team', 'get', '/leave/calendar?year=2026&month=12&scope=all')).status).toBe(403);
    expect(day(await read('hrb'), '2026-12-02').items).toEqual([]);
  });

  it('filters history by month', async () => {
    await apply('team', '2026-12-01');
    await apply('team', '2026-11-30');
    const res = await api('team', 'get', '/leave/requests?month=12&year=2026');
    expect(res.body.data).toHaveLength(1);
  });
});

describe('attendance rules (ATT-001 to ATT-008, W5, W7)', () => {
  it('allows check-in on a weekend or holiday and records it, but not on full-day approved leave', async () => {
    await holiday('2026-11-18');
    expect((await api('team', 'post', '/attendance/check-in')).status).toBe(201);
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,'2026-11-18','2026-11-18','x',1,'APPROVED',now())`, [id(), A, emp('peer'), casual]);
    const blocked = await api('peer', 'post', '/attendance/check-in');
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details.code).toBe('ON_APPROVED_LEAVE');
    now = new Date('2026-11-21T05:00:00.000Z'); // Saturday
    expect((await api('sub', 'post', '/attendance/check-in')).status).toBe(201);
  });

  it('refuses attendance and leave before the employee is Active', async () => {
    await admin.query(`update hr.employees set status='ONBOARDING' where id=$1`, [emp('team')]);
    expect((await api('team', 'post', '/attendance/check-in')).body.error.details.code).toBe('EMPLOYEE_NOT_ACTIVE');
    expect((await apply('team', '2026-12-01')).body.error.details.code).toBe('EMPLOYEE_NOT_ACTIVE');
  });

  const correction = (who: string, date: string, extra: Record<string, unknown> = {}) =>
    api(who, 'post', '/attendance/corrections', { date, proposedCheckInAt: `${date}T04:00:00.000Z`, proposedCheckOutAt: `${date}T12:00:00.000Z`, reason: 'missed', ...extra });

  it('blocks a correction on an approved-leave date and times outside the date', async () => {
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,'2026-11-17','2026-11-17','x',1,'APPROVED',now())`, [id(), A, emp('team'), casual]);
    expect((await correction('team', '2026-11-17')).body.error.details.code).toBe('CORRECTION_ON_LEAVE_DATE');
    expect((await correction('team', '2026-11-16', { proposedCheckOutAt: '2026-11-17T12:00:00.000Z' })).body.error.details.code).toBe('TIME_OUTSIDE_DATE');
    expect((await correction('team', '2026-11-18', { proposedCheckOutAt: '2026-11-18T12:00:00.000Z' })).status).toBe(400); // in the future
  });

  it('keeps one pending correction per date even under concurrency (database index)', async () => {
    await api('team', 'get', '/me');
    const results = await Promise.all([correction('team', '2026-11-16'), correction('team', '2026-11-16')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await q(`select 1 from pg_indexes where schemaname='hr' and indexname='attendance_corrections_one_pending_key'`)).toHaveLength(1);
  });

  it('notifies the approver and then the employee, and decides once (ATT-006, NOTIF-002)', async () => {
    const correctionId = (await correction('team', '2026-11-16')).body.data.id;
    expect(await notes('mgr')).toEqual(['CORRECTION_REQUESTED']);
    await api('mgr', 'get', '/me');
    await api('hr', 'get', '/me');
    const results = await Promise.all([
      api('mgr', 'patch', `/attendance/corrections/${correctionId}/review`, { status: 'APPROVED' }),
      api('hr', 'patch', `/attendance/corrections/${correctionId}/review`, { status: 'REJECTED', comment: 'no' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await notes('team')).toHaveLength(1);
    expect(await q(`select 1 from hr.audit_logs where action like 'attendance.correction_%d' and action <> 'attendance.correction_requested'`)).toHaveLength(1);
  });

  it('tells the employee about a manual correction (ATT-007)', async () => {
    const res = await api('hr', 'post', '/attendance/manual-corrections', { employeeId: emp('team'), date: '2026-11-16', checkInAt: '2026-11-16T04:00:00.000Z', checkOutAt: '2026-11-16T12:00:00.000Z', reason: 'kiosk' });
    expect(res.status).toBe(200);
    expect(await notes('team')).toEqual(['ATTENDANCE_CORRECTED']);
  });

  it('monthly history totals equal the daily rows (ATT-003)', async () => {
    // November 2026 up to today (Wed 18th): 12 working days (2-6, 9-13, 16-18 = 13) minus the holiday on the 10th.
    await holiday('2026-11-10');
    const record = (date: string, out: string | null) =>
      admin.query(`INSERT INTO hr.attendance_records (id,"companyId","employeeId",date,"checkInAt","checkOutAt","workedMinutes","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, [id(), A, emp('team'), date, `${date}T04:00:00Z`, out, out ? 480 : null]);
    await record('2026-11-02', '2026-11-02T12:00:00Z');
    await record('2026-11-03', null); // missing check-out: present with 0 hours
    await record('2026-11-07', '2026-11-07T12:00:00Z'); // worked Saturday
    await admin.query(`INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate",reason,days,status,"updatedAt") VALUES ($1,$2,$3,$4,'2026-11-05','2026-11-09','x',3,'APPROVED',now())`, [id(), A, emp('team'), casual]);
    const body = attendanceListResponseSchema.parse((await api('team', 'get', '/attendance/history?month=11&year=2026')).body);
    // present: 2, 3, 7. leave: 5, 6, 9. holiday: 10. absent: 4, 11, 12, 13, 16, 17 (today is still "not yet in").
    expect(body.summary).toEqual({ present: 3, absent: 6, onLeave: 3, holidays: 1, hoursWorked: 16, missingCheckout: 1 });
    expect(body.days).toHaveLength(18);
    expect(body.days!.filter((d) => d.status === 'ABSENT')).toHaveLength(body.summary!.absent);
    expect(body.days!.find((d) => d.date === '2026-11-18')!.status).toBe('NOT_YET_IN');
    expect((await api('mgr2', 'get', `/attendance/history?employeeId=${emp('team')}&month=11&year=2026`)).status).toBe(403);
  });

  it('reports and exports the month for HR only, scoped to the company (ATT-008)', async () => {
    await admin.query(`update hr.employees set "firstName"='=cmd' where id=$1`, [emp('peer')]);
    const json = attendanceReportResponseSchema.parse((await api('hr', 'get', '/attendance/report?year=2026&month=11&pageSize=100')).body);
    expect(json.page.total).toBe(7);
    const csv = await api('hr', 'get', '/attendance/report?year=2026&month=11&format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain("'=cmd");
    expect(csv.text).not.toContain('empb');
    expect((await api('mgr', 'get', '/attendance/report?year=2026&month=11')).status).toBe(403);
    expect((await api('team', 'get', '/attendance/report?year=2026&month=11')).status).toBe(403);
    const other = attendanceReportResponseSchema.parse((await api('hrb', 'get', '/attendance/report?year=2026&month=11')).body);
    expect(other.page.total).toBe(2);
  });
});

describe('dashboards (DASH-001 to DASH-003)', () => {
  it('shows "not yet in" during the day and "absent" only after work end, matching the overview', async () => {
    await api('team', 'post', '/attendance/check-in');
    await admin.query(`update hr.employees set status='ONBOARDING', "joiningDate"='2026-11-16' where id=$1`, [emp('sub')]);
    const read = async () => hrDashboardResponseSchema.parse((await api('hr', 'get', '/dashboard/hr')).body).data;
    const midday = await read();
    expect(midday).toMatchObject({ totalEmployees: 7, activeEmployees: 6, presentToday: 1, notYetInToday: 5, absentToday: 0 });
    expect(midday.joiners.map((j) => j.id)).toEqual([emp('sub')]);
    expect(midday.joinersLast30Days).toBe(1);
    now = EVENING;
    const evening = await read();
    expect(evening).toMatchObject({ presentToday: 1, notYetInToday: 0, absentToday: 5 });
    const overview = (await api('hr', 'get', '/attendance/overview?date=2026-11-18')).body.summary;
    expect(overview.ABSENT).toBe(evening.absentToday);
  });

  it('counts nobody absent on a holiday, and recent activity carries no record values', async () => {
    await holiday('2026-11-18');
    await api('hr', 'post', '/leave/balances/adjust', { employeeId: emp('team'), leaveTypeId: casual, year: 2026, amount: 1, reason: 'secret-reason' });
    now = EVENING;
    const res = await api('hr', 'get', '/dashboard/hr');
    expect(res.body.data).toMatchObject({ absentToday: 0, notYetInToday: 0 });
    expect(res.body.data.recentActivities.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body.data.recentActivities)).not.toMatch(/secret-reason|oldValue|newValue/);
  });

  it('gives a Manager the whole team, direct and indirect, with routed approvals', async () => {
    await apply('sub', '2026-12-01');
    await apply('peer', '2026-12-01');
    const data = managerDashboardResponseSchema.parse((await api('mgr', 'get', '/dashboard/manager')).body).data;
    expect(data.teamMembers).toBe(2);
    expect(data.pendingApprovals).toBe(1);
    expect(data.teamLeaveCalendar.map((r) => r.employeeId)).toEqual([emp('sub')]);
    expect((await api('team', 'get', '/dashboard/manager')).status).toBe(403);
    expect((await api('mgr', 'get', '/dashboard/hr')).status).toBe(403);
  });

  it('shows an employee every active leave type and the true button state', async () => {
    const data = employeeDashboardResponseSchema.parse((await api('team', 'get', '/dashboard/employee')).body).data;
    expect(data.attendanceState.action).toBe('CHECK_IN');
    expect(data.leaveBalances).toEqual([expect.objectContaining({ leaveTypeName: 'Casual', available: 12 })]);
  });
});

describe('employee lifecycle (EMP-006, EMP-007, W3, W10)', () => {
  const status = (who: string, employee: string, body: object) => put(who, `/employees/${emp(employee)}/status`, body);

  it('needs a joining date and a manager (or an explicit "no manager") to become Active', async () => {
    await admin.query(`update hr.employees set status='ONBOARDING', "managerId"=null where id=$1`, [emp('peer')]);
    expect((await status('hr', 'peer', { status: 'ACTIVE' })).body.error.details[0].path).toEqual(['joiningDate']);
    await admin.query(`update hr.employees set "joiningDate"='2026-11-01' where id=$1`, [emp('peer')]);
    expect((await status('hr', 'peer', { status: 'ACTIVE' })).body.error.details[0].path).toEqual(['managerId']);
    expect((await status('hr', 'peer', { status: 'ACTIVE', noManager: true })).status).toBe(200);
  });

  it('offboarding disables the login, cancels pending and future leave and corrections, and flags reports', async () => {
    const pending = (await apply('team', '2026-12-01')).body.data.id;
    const approved = (await apply('team', '2026-12-08', '2026-12-09')).body.data.id;
    await review('mgr', approved);
    await api('team', 'post', '/attendance/corrections', { date: '2026-11-16', proposedCheckInAt: '2026-11-16T04:00:00.000Z', proposedCheckOutAt: '2026-11-16T12:00:00.000Z', reason: 'x' });
    const res = await status('hr', 'team', { status: 'INACTIVE', exitDate: '2026-11-18' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await api('team', 'get', '/me')).status).toBe(401); // existing session revoked
    // the existing sign-in contract: a correct password without an active membership is refused with 400, no session
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: h.people.team!.email, password: PASSWORD })).status).toBe(400);
    expect(await q(`select status from hr.leave_requests where id = any($1) order by status`, [[pending, approved]])).toEqual([{ status: 'CANCELLED' }, { status: 'CANCELLED' }]);
    expect(await q(`select used, "pendingReserved" p from hr.leave_balances where "employeeId"=$1`, [emp('team')])).toEqual([{ used: 0, p: 0 }]);
    expect(await q(`select status from hr.attendance_corrections where "employeeId"=$1`, [emp('team')])).toEqual([{ status: 'REJECTED' }]);
    expect(await notes('hr')).toContain('REPORTS_NEED_MANAGER');
    // login is re-enabled manually, and only after the record is reactivated
    const [membership] = await q<{ id: string }>(`select id from hr.company_memberships where "employeeId"=$1`, [emp('team')]);
    expect((await api('hr', 'patch', `/settings/users/${membership!.id}/status`, { status: 'ACTIVE' })).status).toBe(409);
    expect((await status('hr', 'team', { status: 'ACTIVE' })).status).toBe(400); // no joining date on the seeded record
    await admin.query(`update hr.employees set "joiningDate"='2024-01-01' where id=$1`, [emp('team')]);
    expect((await status('hr', 'team', { status: 'ACTIVE' })).status).toBe(200);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: h.people.team!.email, password: PASSWORD })).status).toBe(400);
    expect((await api('hr', 'patch', `/settings/users/${membership!.id}/status`, { status: 'ACTIVE' })).status).toBe(200);
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: h.people.team!.email, password: PASSWORD })).status).toBe(200);
  });

  it('protects Super Admins: HR cannot offboard one, and the last one cannot be offboarded', async () => {
    expect((await status('hr', 'sa', { status: 'INACTIVE', exitDate: '2026-11-18' })).status).toBe(403);
    expect((await status('sa', 'sa', { status: 'INACTIVE', exitDate: '2026-11-18' })).status).toBe(400);
  });

  it('gives every role a limited directory of their own company only (EMP-003)', async () => {
    const body = directoryResponseSchema.parse((await api('team', 'get', '/employees/directory?pageSize=100')).body);
    expect(body.page.total).toBe(7);
    expect(body.data.map((d) => d.id)).not.toContain(emp('empb'));
    expect((await api('hrb', 'get', '/employees/directory')).body.page.total).toBe(2);
  });

  it('records employee changes in the company audit log', async () => {
    await api('hr', 'patch', `/employees/${emp('team')}`, { jobTitle: 'Lead' });
    expect(await q(`select action from hr.audit_logs where entity='Employee' and "entityId"=$1`, [emp('team')])).toEqual([{ action: 'employee.updated' }]);
  });
});

describe('invitation and password reset by email (AUTH-002, AUTH-004, W4)', () => {
  const tokenFrom = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)![1]!);
  const hire = async () => {
    const res = await api('hr', 'post', '/employees', { firstName: 'Nina', lastName: 'New', workEmail: 'nina@example.com', joiningDate: '2026-11-18', departmentId: dept, designationId: designation });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  };
  const accept = (token: string, password = 'a-long-new-password') => request(h.app).post('/api/v1/auth/accept-invitation').send({ token, password });

  it('invites from the employee record, emails the link, activates once and tells HR', async () => {
    const employeeId = await hire();
    const invite = await api('hr', 'post', `/employees/${employeeId}/invite`);
    expect(invite.status, JSON.stringify(invite.body)).toBe(202);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]!.to).toBe('nina@example.com');
    const token = tokenFrom(mailer.outbox[0]!.text);
    expect((await api('hr', 'get', `/employees/${employeeId}`)).body.data.invitationStatus).toBe('INVITED');
    const activated = await accept(token);
    expect(activated.status).toBe(200);
    expect(String(activated.headers['set-cookie'])).toContain('gsc_session=');
    expect((await accept(token)).status).toBe(401); // single use
    expect((await api('hr', 'get', `/employees/${employeeId}`)).body.data.invitationStatus).toBe('ACTIVATED');
    expect(await notes('hr')).toContain('INVITATION_ACCEPTED');
    expect((await request(h.app).post('/api/v1/auth/login').send({ email: 'nina@example.com', password: 'a-long-new-password', roleKey: 'EMPLOYEE' })).status).toBe(200);
    expect((await api('hr', 'post', `/employees/${employeeId}/invite`)).status).toBe(409);
  });

  it('a resend voids the earlier link, and simultaneous acceptance succeeds once', async () => {
    const employeeId = await hire();
    await api('hr', 'post', `/employees/${employeeId}/invite`);
    const resent = await api('hr', 'post', `/employees/${employeeId}/invite`);
    expect(resent.body.data.status).toBe('RESENT');
    const [first, second] = mailer.outbox.map((m) => tokenFrom(m.text));
    expect((await accept(first!)).status).toBe(401);
    const results = await Promise.all([accept(second!), accept(second!, 'another-long-password')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('expired links, high roles from HR, reused emails and outsiders are refused', async () => {
    const employeeId = await hire();
    expect((await api('hr', 'post', `/employees/${employeeId}/invite`, { roleKey: 'HR_ADMIN' })).status).toBe(403);
    expect((await api('mgr', 'post', `/employees/${employeeId}/invite`)).status).toBe(403);
    expect((await api('hrb', 'post', `/employees/${employeeId}/invite`)).status).toBe(404);
    expect(mailer.outbox).toHaveLength(0);
    await api('hr', 'post', `/employees/${employeeId}/invite`);
    await admin.query(`update hr.invitation_tokens set "expiresAt" = (now() at time zone 'utc') - interval '1 minute'`); // stored as UTC
    expect((await accept(tokenFrom(mailer.outbox[0]!.text))).status).toBe(401);
    // an address that already signs in cannot be taken over by an invitation
    await admin.query(`update hr.employees set "workEmail"=$1 where id=$2`, [h.people.empb!.email, emp('peer')]);
    await admin.query(`delete from hr.company_memberships where "employeeId"=$1`, [emp('peer')]);
    const taken = await api('hr', 'post', `/employees/${emp('peer')}/invite`);
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/already used/);
  });

  it('emails a single-use reset link; only the newest works; unknown addresses answer the same', async () => {
    const forgot = (email: string) => request(h.app).post('/api/v1/auth/forgot-password').send({ email });
    await api('team', 'get', '/me');
    const unknown = await forgot('nobody@example.com');
    const known = await forgot(h.people.team!.email);
    expect(known.body).toEqual(unknown.body);
    await forgot(h.people.team!.email);
    expect(mailer.outbox).toHaveLength(2);
    const [older, newer] = mailer.outbox.map((m) => tokenFrom(m.text));
    const reset = (token: string, password: string) => request(h.app).post('/api/v1/auth/reset-password').send({ token, password });
    expect((await reset(older!, 'brand-new-password-1')).status).toBe(401);
    expect((await reset(newer!, 'short')).status).toBe(400);
    const results = await Promise.all([reset(newer!, 'brand-new-password-1'), reset(newer!, 'brand-new-password-2')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect((await api('team', 'get', '/me')).status).toBe(401); // sessions revoked
    expect(await q(`select 1 from hr.audit_logs where action='PASSWORD_RESET'`)).toHaveLength(1);
  });
});

describe('onboarding access and tracking (ONB-001 to ONB-005)', () => {
  const setup = async () => {
    const task = async (employee: string, assigneeType: 'HR' | 'EMPLOYEE', title: string) =>
      (await api('hr', 'post', `/onboarding/employees/${emp(employee)}/tasks`, { title, assigneeType })).body.data.id as string;
    return { mine: await task('team', 'EMPLOYEE', 'Upload ID'), hrs: await task('team', 'HR', 'Create accounts') };
  };

  it('is closed to Managers; an employee completes only own employee tasks', async () => {
    const { mine, hrs } = await setup();
    expect(await notes('team')).toEqual(['ONBOARDING_TASK_ASSIGNED']);
    expect((await api('mgr', 'get', `/onboarding/employees/${emp('team')}/tasks`)).status).toBe(403);
    expect((await api('mgr', 'patch', `/onboarding/tasks/${mine}/complete`)).status).toBe(403);
    expect((await api('peer', 'patch', `/onboarding/tasks/${mine}/complete`)).status).toBe(403);
    expect((await api('team', 'patch', `/onboarding/tasks/${hrs}/complete`)).status).toBe(403);
    const done = await api('team', 'patch', `/onboarding/tasks/${mine}/complete`);
    expect(done.body.progress).toMatchObject({ completed: 1, total: 2, status: 'IN_PROGRESS' });
    expect(done.body.data.completedByUserId).toBe(user('team'));
    await api('hr', 'patch', `/onboarding/tasks/${hrs}/complete`);
    expect((await notes('sa')).filter((t) => t.startsWith('ONBOARDING_COMPLETED'))).toHaveLength(1);
  });

  it('lists derived status and invite state, filterable, for HR of that company only', async () => {
    const { mine } = await setup();
    await api('team', 'patch', `/onboarding/tasks/${mine}/complete`);
    const list = async (who: string, query = '') => onboardingProgressListResponseSchema.parse((await api(who, 'get', `/onboarding/progress${query}`)).body);
    expect((await list('hr')).data).toEqual([expect.objectContaining({ employeeId: emp('team'), invitationStatus: 'ACTIVATED', progress: expect.objectContaining({ status: 'IN_PROGRESS' }) })]);
    expect((await list('hr', '?status=COMPLETED')).page.total).toBe(0);
    expect((await list('hr', '?search=tea')).page.total).toBe(1);
    expect((await list('hrb')).page.total).toBe(0);
    expect((await api('mgr', 'get', '/onboarding/progress')).status).toBe(403);
    expect((await api('team', 'get', '/onboarding/progress')).status).toBe(403);
  });
});

describe('documents and organisation rules', () => {
  it('department and designation names are unique ignoring case (ORG-002)', async () => {
    const dup = await api('hr', 'post', '/organization/departments', { name: 'ENGINEERING' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toMatch(/unique/i);
    expect((await api('hr', 'post', '/organization/designations', { name: 'engineer' })).status).toBe(400);
    expect((await api('hrb', 'post', '/organization/departments', { name: 'Engineering' })).status).toBe(201); // per company
  });

  const upload = async (who: string, owner: string, extra: Record<string, string> = {}) => {
    if (!h.sessions[who]) await h.login(who);
    let req = h.raw(who, 'post', '/documents/employee').field('employeeId', emp(owner)).field('category', 'ID_PROOF');
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return req.attach('file', Buffer.from('%PDF-1.7 test'), { filename: 'id.pdf', contentType: 'application/pdf' });
  };

  it('only HR can flag a document for managers, and the flag reaches indirect managers (DOC-004)', async () => {
    const own = await upload('sub', 'sub', { visibleToManager: 'true' });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(await q(`select "visibleToManager" v from hr.employee_documents`)).toEqual([{ v: false }]);
    expect((await api('mgr', 'get', `/documents/${own.body.data.id}/download`)).status).toBe(403);
    await api('hr', 'patch', `/documents/${own.body.data.id}/visibility`, { visibleToManager: true });
    expect((await api('mgr', 'get', `/documents/${own.body.data.id}/download`)).status).toBe(200);
    expect((await api('mgr2', 'get', `/documents/${own.body.data.id}/download`)).status).toBe(403);
  });

  it('archives a department that is in use, and still refuses to delete it (ORG-002)', async () => {
    expect((await api('hr', 'delete', `/organization/departments/${dept}`)).status).toBe(400);
    const archived = await api('hr', 'patch', `/organization/departments/${dept}`, { isActive: false });
    expect(archived.status).toBe(200);
    expect(await q(`select count(*)::int n from hr.employees where "departmentId"=$1`, [dept])).toEqual([{ n: 2 }]);
    expect(await q(`select 1 from hr.audit_logs where action='department.updated'`)).toHaveLength(1);
  });
});

describe('settings and audit log (SET-001 to SET-004)', () => {
  it('lets HR view company settings but not change them', async () => {
    expect((await api('hr', 'get', '/settings/company')).status).toBe(200);
    expect((await api('hr', 'patch', '/settings/company', { name: 'x', timezone: 'UTC', workingDays: [1], workStartTime: '09:00', workEndTime: '10:00' })).status).toBe(403);
    expect((await api('mgr', 'get', '/settings/company')).status).toBe(403);
  });

  it('filters the audit log by user, record type and company-local date, for Super Admin only', async () => {
    await api('hr', 'post', '/leave/balances/adjust', { employeeId: emp('team'), leaveTypeId: casual, year: 2026, amount: 1, reason: 'a' });
    await api('sa', 'patch', `/organization/departments/${dept}`, { name: 'Platform' });
    await admin.query(`update hr.audit_logs set "createdAt"='2026-11-17T19:00:00' where entity='LeaveBalance'`); // 00:30 on the 18th locally
    const read = async (query: string) => auditLogListResponseSchema.parse((await api('sa', 'get', `/settings/audit-logs${query}`)).body);
    expect((await read(`?actorId=${user('hr')}`)).data.map((r) => r.entity)).toEqual(['LeaveBalance']);
    expect((await read(`?actorId=${user('hr')}`)).data[0]!.actorName).toBe('hr');
    expect((await read('?entity=Department')).page.total).toBe(1);
    expect((await read('?entity=LeaveBalance&from=2026-11-18&to=2026-11-18')).page.total).toBe(1);
    expect((await read('?entity=LeaveBalance&to=2026-11-17')).page.total).toBe(0);
    expect((await read('?pageSize=1')).data).toHaveLength(1);
    for (const who of ['hr', 'mgr', 'team']) expect((await api(who, 'get', '/settings/audit-logs')).status, who).toBe(403);
    await h.seedPerson(B, 'sab', 'SUPER_ADMIN');
    expect((await api('sab', 'get', '/settings/audit-logs')).body.page.total).toBe(0);
  });

  it('keeps the audit log append-only for the runtime role', async () => {
    await api('sa', 'patch', `/organization/departments/${dept}`, { name: 'Platform' });
    const runtime = await connect('TEST_DATABASE_URL');
    try {
      await runtime.query(`select set_config('app.company_id', $1, false)`, [A]);
      await expect(runtime.query('update hr.audit_logs set action = $1', ['x'])).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('delete from hr.audit_logs')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await runtime.end();
    }
  });
});
