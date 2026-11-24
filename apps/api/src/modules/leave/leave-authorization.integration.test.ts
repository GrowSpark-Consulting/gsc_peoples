/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, type RoleKey } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from '../auth/password';

/**
 * Leave authorization against REAL PostgreSQL (scratch database): PRD LEAVE-005 (no self-approval, for anyone)
 * and section 5 (a Manager sees team leave only; nobody sees another company's requests).
 */

const PASSWORD = 'correct-horse-battery';
const A = randomUUID();
const B = randomUUID();
const TYPE = randomUUID();
const id = () => randomUUID();

let admin: pg.Client;
let app: Express;
let disconnect: () => Promise<void>;
const people: Record<string, { user: string; emp: string; email: string }> = {};
const sessions: Record<string, { cookie: string; csrf: string }> = {};

const cookiesOf = (res: request.Response): Record<string, string> =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  );
async function login(who: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email: people[who]!.email, password: PASSWORD });
  expect(res.status, `login ${who}`).toBe(200);
  const c = cookiesOf(res);
  return { cookie: `gsc_session=${encodeURIComponent(c.gsc_session!)}; gsc_csrf=${encodeURIComponent(c.gsc_csrf!)}`, csrf: c.gsc_csrf! };
}
const api = (who: string, method: 'get' | 'post' | 'patch', url: string, body?: unknown) => {
  const s = sessions[who]!;
  let req = (request(app) as any)[method](`/api/v1${url}`).set('cookie', s.cookie);
  if (method !== 'get') req = req.set('x-csrf-token', s.csrf);
  return body === undefined ? req : req.send(body);
};

async function seedPerson(company: string, key: string, roleId: string, managerKey?: string) {
  const user = id();
  const emp = id();
  const email = `${key}@example.com`;
  await admin.query(`INSERT INTO hr.users (id,"externalId",email,name,"passwordHash","updatedAt") VALUES ($1,$1,$2,$3,$4,now())`, [user, email, key, hashPassword(PASSWORD)]);
  await admin.query(
    `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","managerId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now())`,
    [emp, company, `E-${key}`, key, key.toUpperCase(), managerKey ? people[managerKey]!.emp : null],
  );
  await admin.query(`INSERT INTO hr.company_memberships (id,"companyId","userId","roleId","employeeId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`, [id(), company, user, roleId, emp]);
  people[key] = { user, emp, email };
}

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
  app = createApp({ authProvider: new DevAuthProvider(A) });
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

beforeEach(async () => {
  await resetData(admin);
  for (const k of Object.keys(people)) delete people[k];
  await admin.query(`INSERT INTO hr.companies (id,name,timezone,"updatedAt") VALUES ($1,'Acme','Asia/Kolkata',now())`, [A]);
  await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,'Other Co',now())`, [B]);
  const roles: Record<string, string> = {};
  for (const company of [A, B])
    for (const key of ROLE_KEYS) {
      const rid = id();
      roles[`${company}:${key}`] = rid;
      await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [rid, company, key]);
    }
  const r = (c: string, k: RoleKey) => roles[`${c}:${k}`]!;
  // sa -> hr, sa -> mgr -> team, sa -> peer ; company B has its own HR and employee
  await seedPerson(A, 'sa', r(A, 'SUPER_ADMIN'));
  await seedPerson(A, 'hr', r(A, 'HR_ADMIN'), 'sa');
  await seedPerson(A, 'mgr', r(A, 'MANAGER'), 'sa');
  await seedPerson(A, 'team', r(A, 'EMPLOYEE'), 'mgr');
  await seedPerson(A, 'peer', r(A, 'EMPLOYEE'), 'sa');
  await seedPerson(B, 'hrb', r(B, 'HR_ADMIN'));
  await seedPerson(B, 'empb', r(B, 'EMPLOYEE'));
  await admin.query(
    `INSERT INTO hr.leave_types (id,"companyId",name,"annualAllocation","isPaid","allowHalfDay","isActive","updatedAt") VALUES ($1,$2,'Casual',12,true,true,true,now())`,
    [TYPE, A],
  );
  for (const who of ['sa', 'hr', 'mgr', 'team', 'peer']) sessions[who] = await login(who);
});

const apply = (who: string, start: string, end = start) =>
  api(who, 'post', '/leave/requests', { leaveTypeId: TYPE, startDate: start, endDate: end, dayType: 'FULL_DAY', reason: `leave of ${who}` });
// Far-future weekdays (Mon 2099-03-02 ...) so the start-date rules never interfere.
const D = ['2099-03-02', '2099-03-03', '2099-03-04', '2099-03-05'];

describe('LEAVE-005: nobody approves their own leave', () => {
  it('HR Admin cannot approve or reject their own request (403) and it stays pending', async () => {
    const created = await apply('hr', D[0]!);
    expect(created.status).toBe(201);
    const leaveId = created.body.data.id;
    for (const status of ['APPROVED', 'REJECTED'])
      expect((await api('hr', 'patch', `/leave/requests/${leaveId}/review`, { status, comment: 'x' })).status).toBe(403);
    const row = (await admin.query(`SELECT status FROM hr.leave_requests WHERE id=$1`, [leaveId])).rows[0];
    expect(row.status).toBe('PENDING');
  });

  it('a Manager cannot approve their own request; another approver (their manager, SA) can', async () => {
    const created = await apply('mgr', D[1]!);
    expect(created.status).toBe(201);
    const leaveId = created.body.data.id;
    expect((await api('mgr', 'patch', `/leave/requests/${leaveId}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('sa', 'patch', `/leave/requests/${leaveId}/review`, { status: 'APPROVED' })).status).toBe(200);
    expect((await admin.query(`SELECT status FROM hr.leave_requests WHERE id=$1`, [leaveId])).rows[0].status).toBe('APPROVED');
  });

  it('the Super Admin cannot approve their own request either, but HR can approve a team request and an Employee cannot approve anything', async () => {
    const own = await apply('sa', D[2]!);
    expect((await api('sa', 'patch', `/leave/requests/${own.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    const theirs = await apply('team', D[3]!);
    expect((await api('team', 'patch', `/leave/requests/${theirs.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(403);
    expect((await api('hr', 'patch', `/leave/requests/${theirs.body.data.id}/review`, { status: 'APPROVED' })).status).toBe(200);
  });
});

describe('Leave visibility: Manager sees team only; company isolation', () => {
  it('GET /leave/requests with no flags returns only the Manager\'s own and direct reports\' requests', async () => {
    await apply('mgr', D[0]!);
    await apply('team', D[1]!);
    await apply('peer', D[2]!); // not in mgr's team
    await apply('hr', D[3]!); // not in mgr's team
    const res = await api('mgr', 'get', '/leave/requests');
    expect(res.status).toBe(200);
    const who = res.body.data.map((r: any) => r.reason).sort();
    expect(who).toEqual(['leave of mgr', 'leave of team']);
    // the flags cannot widen the scope either
    const widened = await api('mgr', 'get', `/leave/requests?employeeId=${people.peer!.emp}`);
    expect(widened.body.data.every((r: any) => r.employeeId !== people.peer!.emp)).toBe(true);
  });

  it('HR sees every request in the company and never another company\'s', async () => {
    await apply('team', D[0]!);
    await apply('peer', D[1]!);
    await admin.query(
      `INSERT INTO hr.leave_types (id,"companyId",name,"annualAllocation","isPaid","allowHalfDay","isActive","updatedAt") VALUES ($1,$2,'Casual',12,true,true,true,now())`,
      [randomUUID(), B],
    );
    const res = await api('hr', 'get', '/leave/requests');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const empIds = new Set(res.body.data.map((r: any) => r.employeeId));
    expect(empIds.has(people.empb!.emp)).toBe(false);
  });

  it('an Employee sees only their own requests', async () => {
    await apply('team', D[0]!);
    await apply('peer', D[1]!);
    const res = await api('team', 'get', '/leave/requests');
    expect(res.body.data.map((r: any) => r.reason)).toEqual(['leave of team']);
  });
});
