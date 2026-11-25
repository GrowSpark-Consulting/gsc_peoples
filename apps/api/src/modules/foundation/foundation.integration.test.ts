/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, dashboardForRole, permissionsForRole, type RoleKey } from '@gsc/contracts';
import type { withTenant } from '../../database/tenant';
import { connect, TEST_DB, testUrl, type PgError } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from '../auth/password';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';

/**
 * Slice 1 (Foundation) against REAL PostgreSQL (hr_test): the permission matrix, can()-gated routes,
 * /me, the holiday calendar (ORG-004), team scope, company isolation, sessions and the migration.
 *
 * Real: Express app, password login, httpOnly session cookies + CSRF, membership lookup, tenant layer,
 * Prisma as the least-privilege hr_app role, constraints. Nothing is mocked. No `role_permissions`
 * rows are seeded at all: permissions must come from the code-defined role matrix (PRD SET-003).
 */

const PASSWORD = 'correct-horse-battery';
const A = randomUUID();
const DEPT_A = randomUUID(); // a department in company A: the create contract requires one (PRD EMP-001)
const DESIGNATION_A = randomUUID(); // and a designation
const B = randomUUID();
const id = () => randomUUID();

let admin: pg.Client; // hr_migrator: fixtures and assertions
let app: Express;
let disconnect: () => Promise<void>;
let runTenant: typeof withTenant;

interface Person { user: string; emp: string; email: string }
const people: Record<string, Person> = {};
const emps: Record<string, string> = {};

const cookiesOf = (res: request.Response): Record<string, string> =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  );
interface Session { cookie: string; csrf: string }
async function login(who: string): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send({ email: people[who]!.email, password: PASSWORD });
  expect(res.status, `login ${who}`).toBe(200);
  const c = cookiesOf(res);
  return { cookie: `gsc_session=${encodeURIComponent(c.gsc_session!)}; gsc_csrf=${encodeURIComponent(c.gsc_csrf!)}`, csrf: c.gsc_csrf! };
}
const sessions: Record<string, Session> = {};
const api = (who: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown, csrf = true) => {
  const s = sessions[who]!;
  let req = (request(app) as any)[method](`/api/v1${url}`).set('cookie', s.cookie);
  if (csrf && method !== 'get') req = req.set('x-csrf-token', s.csrf);
  return body === undefined ? req : req.send(body);
};

async function seedPerson(company: string, key: string, role: RoleKey, roleId: string, managerKey?: string) {
  const user = id();
  const emp = id();
  const email = `${key}@example.com`;
  await admin.query(
    `INSERT INTO hr.users (id,"externalId",email,name,"passwordHash","updatedAt") VALUES ($1,$1,$2,$3,$4,now())`,
    [user, email, key, hashPassword(PASSWORD)],
  );
  await admin.query(
    `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","managerId",status,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now())`,
    [emp, company, `E-${key}`, key, key.toUpperCase(), managerKey ? emps[managerKey] : null],
  );
  await admin.query(
    `INSERT INTO hr.company_memberships (id,"companyId","userId","roleId","employeeId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`,
    [id(), company, user, roleId, emp],
  );
  people[key] = { user, emp, email };
  emps[key] = emp;
  void role;
}

beforeAll(async () => {
  const testAppUrl = testUrl('TEST_DATABASE_URL');
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testAppUrl; // before any app module is imported
  const { createApp } = await import('../../app');
  const { DevAuthProvider } = await import('../../integrations/central-auth/dev.provider');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  const tenant = await import('../../database/tenant');
  disconnect = disconnectDatabase;
  runTenant = tenant.withTenant;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB); // never hr_db
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
  await admin.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now())`, [DEPT_A, A]);
  await admin.query(`INSERT INTO hr.designations (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineer',now())`, [DESIGNATION_A, A]);
  const roleIds: Record<string, string> = {};
  for (const company of [A, B]) {
    for (const key of ROLE_KEYS) {
      const rid = id();
      roleIds[`${company}:${key}`] = rid;
      await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [rid, company, key]);
    }
  }
  const r = (company: string, key: RoleKey) => roleIds[`${company}:${key}`]!;
  // Company A hierarchy:  sa -> mgr -> r1 -> grand ;  sa -> hr ;  sa -> peer ;  mgr -> eve
  await seedPerson(A, 'sa', 'SUPER_ADMIN', r(A, 'SUPER_ADMIN'));
  await seedPerson(A, 'hr', 'HR_ADMIN', r(A, 'HR_ADMIN'), 'sa');
  await seedPerson(A, 'mgr', 'MANAGER', r(A, 'MANAGER'), 'sa');
  await seedPerson(A, 'emp', 'EMPLOYEE', r(A, 'EMPLOYEE'), 'mgr'); // eve: mgr's direct report
  await seedPerson(A, 'r1', 'EMPLOYEE', r(A, 'EMPLOYEE'), 'mgr');
  await seedPerson(A, 'grand', 'EMPLOYEE', r(A, 'EMPLOYEE'), 'r1'); // mgr's indirect report
  await seedPerson(A, 'peer', 'EMPLOYEE', r(A, 'EMPLOYEE'), 'sa'); // not in mgr's team
  await seedPerson(B, 'hrb', 'HR_ADMIN', r(B, 'HR_ADMIN'));
  await seedPerson(B, 'bossb', 'EMPLOYEE', r(B, 'EMPLOYEE'));
  for (const who of ['sa', 'hr', 'mgr', 'emp', 'hrb']) sessions[who] = await login(who);
});

const ROLE_OF: Record<string, RoleKey> = { sa: 'SUPER_ADMIN', hr: 'HR_ADMIN', mgr: 'MANAGER', emp: 'EMPLOYEE' };
const holiday = (date: string, name = 'Holiday') => ({ date, name });
const auditRows = async () =>
  (await admin.query(`SELECT "actorId", action, entity, "entityId", "oldValue", "newValue", "companyId" FROM hr.audit_logs WHERE entity='holiday' ORDER BY "createdAt", id`)).rows;

describe('GET /me for all four roles (real sessions, no role_permissions rows)', () => {
  for (const who of ['sa', 'hr', 'mgr', 'emp']) {
    it(`${ROLE_OF[who]}: role, permissions, dashboard, employee link and company configuration`, async () => {
      const res = await api(who, 'get', '/me');
      expect(res.status).toBe(200);
      const d = res.body.data;
      const role = ROLE_OF[who]!;
      expect(d.role).toBe(role);
      expect(d.roles).toEqual([role]); // one role per user per company
      expect([...d.permissions].sort()).toEqual([...permissionsForRole(role)].sort());
      expect(d.dashboard).toBe(dashboardForRole(role));
      expect(d.companyId).toBe(A);
      expect(d.employeeId).toBe(people[who]!.emp);
      expect(d.company).toEqual({
        name: 'Acme',
        timezone: 'Asia/Kolkata',
        workingDays: [1, 2, 3, 4, 5],
        workStartTime: '09:00',
        workEndTime: '18:00', // PRD A3: new companies default to 09:00-18:00
      });
    });
  }

  it('company and role come from the session only: headers and body cannot change them', async () => {
    const res = await api('emp', 'get', '/me').set('x-company-id', B).set('x-role', 'SUPER_ADMIN');
    expect(res.body.data.companyId).toBe(A);
    expect(res.body.data.role).toBe('EMPLOYEE');
    expect(res.body.data.permissions).not.toContain('company:write');
  });

  it('requires authentication (401) and a valid session', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/me').set('cookie', 'gsc_session=forged')).status).toBe(401);
  });
});

describe('holiday calendar (ORG-004): authorization matrix, enforced by the API', () => {
  it('every role may view holidays', async () => {
    await admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ($1,$2,'2026-01-26','Republic Day',now())`, [id(), A]);
    for (const who of ['sa', 'hr', 'mgr', 'emp']) {
      const res = await api(who, 'get', '/holidays');
      expect(res.status, who).toBe(200);
      expect(res.body.data).toEqual([{ id: expect.any(String), date: '2026-01-26', name: 'Republic Day' }]);
    }
  });

  it('only Super Admin and HR Admin create, edit and delete; Manager and Employee get 403 and nothing changes', async () => {
    const created = await api('hr', 'post', '/holidays', holiday('2026-08-15', 'Independence Day'));
    expect(created.status).toBe(201);
    const hid = created.body.data.id;
    for (const who of ['mgr', 'emp']) {
      expect((await api(who, 'post', '/holidays', holiday('2026-12-25'))).status, who).toBe(403);
      expect((await api(who, 'patch', `/holidays/${hid}`, { name: 'Hacked' })).status, who).toBe(403);
      expect((await api(who, 'delete', `/holidays/${hid}`)).status, who).toBe(403);
    }
    const rows = (await admin.query('SELECT name, date::text AS date FROM hr.holidays')).rows;
    expect(rows).toEqual([{ name: 'Independence Day', date: '2026-08-15' }]);
    expect((await api('sa', 'patch', `/holidays/${hid}`, { name: 'Independence Day (India)' })).status).toBe(200);
    expect((await api('sa', 'delete', `/holidays/${hid}`)).status).toBe(204);
    expect((await admin.query('SELECT 1 FROM hr.holidays')).rowCount).toBe(0);
  });

  it('one holiday per date (409 from the real unique constraint); moving onto an existing date is 409 too', async () => {
    expect((await api('hr', 'post', '/holidays', holiday('2026-05-01', 'May Day'))).status).toBe(201);
    const dup = await api('sa', 'post', '/holidays', holiday('2026-05-01', 'Labour Day'));
    expect(dup.status).toBe(409);
    const other = await api('hr', 'post', '/holidays', holiday('2026-05-02', 'Other'));
    expect((await api('hr', 'patch', `/holidays/${other.body.data.id}`, { date: '2026-05-01' })).status).toBe(409);
    expect((await admin.query('SELECT 1 FROM hr.holidays')).rowCount).toBe(2);
  });

  it('validates input on the server: bad dates, blank names, empty patches, bad ids, year filter', async () => {
    for (const bad of [
      { date: '2026-02-30', name: 'x' },
      { date: '26-1-1', name: 'x' },
      { date: '2026-01-01', name: '   ' },
      { date: '2026-01-01' },
      { name: 'x' },
    ])
      expect((await api('hr', 'post', '/holidays', bad)).status, JSON.stringify(bad)).toBe(400);
    const ok = await api('hr', 'post', '/holidays', holiday('2026-01-01', 'New Year'));
    expect((await api('hr', 'patch', `/holidays/${ok.body.data.id}`, {})).status).toBe(400);
    expect((await api('hr', 'patch', '/holidays/not-a-uuid', { name: 'x' })).status).toBe(400);
    await api('hr', 'post', '/holidays', holiday('2027-01-01', 'Next year'));
    expect((await api('emp', 'get', '/holidays?year=2026')).body.data.map((h: any) => h.name)).toEqual(['New Year']);
    expect((await api('emp', 'get', '/holidays?year=1')).status).toBe(400);
  });

  it('writes need a valid CSRF token (cookie sessions)', async () => {
    const res = await api('hr', 'post', '/holidays', holiday('2026-03-03'), false);
    expect(res.status).toBe(403);
    expect((await admin.query('SELECT 1 FROM hr.holidays')).rowCount).toBe(0);
  });

  it('every change is audit-logged with actor, company and old/new values', async () => {
    const c = await api('hr', 'post', '/holidays', holiday('2026-10-02', 'Gandhi Jayanti'));
    await api('sa', 'patch', `/holidays/${c.body.data.id}`, { name: 'Gandhi Jayanti (national)' });
    await api('sa', 'delete', `/holidays/${c.body.data.id}`);
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['CREATED', 'UPDATED', 'DELETED']);
    expect(rows.every((r) => r.companyId === A && r.entityId === c.body.data.id)).toBe(true);
    expect(rows[0]).toMatchObject({ actorId: people.hr!.user, oldValue: null });
    expect(rows[1]).toMatchObject({ actorId: people.sa!.user });
    expect(rows[1].oldValue.name).toBe('Gandhi Jayanti');
    expect(rows[1].newValue.name).toBe('Gandhi Jayanti (national)');
    expect(rows[2].newValue).toBeNull();
  });
});

describe('company isolation', () => {
  it('another company never sees, edits or deletes this company\'s holidays; the same date may exist in both', async () => {
    const a = await api('hr', 'post', '/holidays', holiday('2026-11-01', 'A day'));
    expect((await api('hrb', 'get', '/holidays')).body.data).toEqual([]);
    expect((await api('hrb', 'patch', `/holidays/${a.body.data.id}`, { name: 'stolen' })).status).toBe(404);
    expect((await api('hrb', 'delete', `/holidays/${a.body.data.id}`)).status).toBe(404);
    expect((await api('hrb', 'post', '/holidays', holiday('2026-11-01', 'B day'))).status).toBe(201);
    expect((await admin.query(`SELECT name FROM hr.holidays WHERE "companyId"=$1`, [A])).rows).toEqual([{ name: 'A day' }]);
    expect((await api('hr', 'get', '/holidays')).body.data.map((h: any) => h.name)).toEqual(['A day']);
  });

  it('a foreign employee id is 404 for every role, and changing the id in the URL never exposes data', async () => {
    for (const who of ['sa', 'hr', 'mgr', 'emp']) {
      expect((await api(who, 'get', `/employees/${emps.bossb}`)).status, who).toBe(404);
    }
    expect((await api('hrb', 'get', `/employees/${emps.sa}`)).status).toBe(404);
  });

  it('/me never leaks another company\'s configuration', async () => {
    await admin.query(`UPDATE hr.companies SET name='Secret B', timezone='Pacific/Auckland' WHERE id=$1`, [B]);
    const me = await api('sa', 'get', '/me');
    expect(me.body.data.company.name).toBe('Acme');
  });
});

describe('team scope = direct and indirect reports (PRD section 5)', () => {
  it('resolveTeamEmployeeIds follows the reporting line across levels, inside the company', async () => {
    const team = await runTenant({ companyId: A }, (db) => resolveTeamEmployeeIds(db, emps.mgr!));
    expect(new Set(team)).toEqual(new Set([emps.emp, emps.r1, emps.grand]));
    expect(await runTenant({ companyId: A }, (db) => resolveTeamEmployeeIds(db, emps.grand!))).toEqual([]);
    expect(await runTenant({ companyId: A }, (db) => resolveTeamEmployeeIds(db, null))).toEqual([]);
    // company B's context cannot walk company A's tree
    expect(await runTenant({ companyId: B }, (db) => resolveTeamEmployeeIds(db, emps.mgr!))).toEqual([]);
  });

  it('API: Manager sees self, direct and indirect reports only; peers and HR are 404', async () => {
    const list = await api('mgr', 'get', '/employees?limit=100');
    expect(new Set(list.body.data.map((e: any) => e.id))).toEqual(
      new Set([emps.mgr, emps.emp, emps.r1, emps.grand]),
    );
    expect((await api('mgr', 'get', `/employees/${emps.grand}`)).status).toBe(200);
    expect((await api('mgr', 'get', `/employees/${emps.peer}`)).status).toBe(404);
    expect((await api('mgr', 'get', `/employees/${emps.hr}`)).status).toBe(404);
    expect((await api('mgr', 'get', `/employees/${emps.sa}`)).status).toBe(404);
  });

  it('API: Employee sees only own record; Super Admin and HR see the whole company (and never company B)', async () => {
    expect((await api('emp', 'get', '/employees')).body.data.map((e: any) => e.id)).toEqual([emps.emp]);
    expect((await api('emp', 'get', `/employees/${emps.r1}`)).status).toBe(404);
    for (const who of ['sa', 'hr']) {
      const ids = (await api(who, 'get', '/employees?limit=100')).body.data.map((e: any) => e.id);
      expect(ids).toHaveLength(7);
      expect(ids).not.toContain(emps.bossb);
    }
  });

  it('only SA and HR can write employees (direct API calls)', async () => {
    const body = { employeeNumber: 'EMP-900', firstName: 'N', lastName: 'W', workEmail: 'n.w@acme.test', joiningDate: '2026-01-05', departmentId: DEPT_A, designationId: DESIGNATION_A };
    expect((await api('hr', 'post', '/employees', body)).status).toBe(201);
    expect((await api('sa', 'post', '/employees', { ...body, employeeNumber: 'EMP-901', workEmail: 'n.w1@acme.test' })).status).toBe(201);
    for (const who of ['mgr', 'emp']) {
      expect((await api(who, 'post', '/employees', { ...body, employeeNumber: 'EMP-902', workEmail: 'n.w2@acme.test' })).status, who).toBe(403);
      expect((await api(who, 'patch', `/employees/${emps.emp}`, { jobTitle: 'CEO' })).status, who).toBe(403);
      expect((await api(who, 'put', `/employees/${emps.emp}/status`, { status: 'INACTIVE' })).status, who).toBe(403);
    }
  });
});

describe('sessions are re-validated on every request', () => {
  it('suspending the membership takes effect on the next request (403), reinstating restores it', async () => {
    expect((await api('hr', 'get', '/holidays')).status).toBe(200);
    await admin.query(`UPDATE hr.company_memberships SET status='SUSPENDED' WHERE "userId"=$1`, [people.hr!.user]);
    expect((await api('hr', 'get', '/holidays')).status).toBe(403);
    expect((await api('hr', 'post', '/holidays', holiday('2026-06-06'))).status).toBe(403);
    await admin.query(`UPDATE hr.company_memberships SET status='ACTIVE' WHERE "userId"=$1`, [people.hr!.user]);
    expect((await api('hr', 'get', '/holidays')).status).toBe(200);
  });

  it('a disabled user, an expired session and a logged-out session are 401', async () => {
    await admin.query(`UPDATE hr.users SET status='DISABLED' WHERE id=$1`, [people.emp!.user]);
    expect((await api('emp', 'get', '/me')).status).toBe(401);

    await admin.query(`UPDATE hr.user_sessions SET "expiresAt" = (now() AT TIME ZONE 'utc') - interval '1 minute' WHERE "userId"=$1`, [people.mgr!.user]);
    expect((await api('mgr', 'get', '/me')).status).toBe(401);

    const out = await api('hr', 'post', '/auth/logout');
    expect([200, 204]).toContain(out.status);
    expect((await api('hr', 'get', '/me')).status).toBe(401);
  });
});

describe('database integrity (real constraints)', () => {
  it('holidays: unique (company, date), FK to companies, non-blank name, DATE type', async () => {
    const ins = (company: string, date: string, name: string) =>
      admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ($1,$2,$3,$4,now())`, [id(), company, date, name]);
    await ins(A, '2026-01-01', 'x');
    await ins(B, '2026-01-01', 'x'); // same date, other company: fine
    await expect(ins(A, '2026-01-01', 'y')).rejects.toMatchObject({ code: '23505' } satisfies Partial<PgError>);
    await expect(ins(randomUUID(), '2026-01-02', 'y')).rejects.toMatchObject({ code: '23503' });
    await expect(ins(A, '2026-01-03', '   ')).rejects.toMatchObject({ code: '23514' });
    const col = await admin.query(
      `SELECT data_type FROM information_schema.columns WHERE table_schema='hr' AND table_name='holidays' AND column_name='date'`,
    );
    expect(col.rows[0].data_type).toBe('date');
  });

  it('a company created without hours gets 09:00-18:00', async () => {
    const c = id();
    await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,'N',now())`, [c]);
    const { rows } = await admin.query(`SELECT "workStartTime","workEndTime","workingDays" FROM hr.companies WHERE id=$1`, [c]);
    expect(rows[0]).toEqual({ workStartTime: '09:00', workEndTime: '18:00', workingDays: [1, 2, 3, 4, 5] });
  });

  it('migration is additive: applied over existing data it keeps every row and value', async () => {
    // Rolled-back transaction in hr_test: restore the pre-migration shape, add legacy data, apply the
    // real migration SQL, check, then ROLLBACK so nothing leaks into other tests.
    const file = path.resolve(import.meta.dirname, '../../database/migrations/20261120090000_foundation_holidays_work_hours/migration.sql');
    const c = admin;
    await c.query('BEGIN');
    try {
      await c.query('DROP TABLE hr.holidays');
      await c.query(`ALTER TABLE hr.companies ALTER COLUMN "workEndTime" SET DEFAULT '17:00'`);
      await c.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ('legacy','Legacy Co',now())`);
      const before = (await c.query(`SELECT * FROM hr.companies WHERE id='legacy'`)).rows[0];
      expect(before.workEndTime).toBe('17:00'); // the old default, stored on an existing row

      await c.query('SET LOCAL search_path = hr');
      await c.query(readFileSync(file, 'utf8')); // the exact SQL that will be applied to hr_db

      const after = (await c.query(`SELECT * FROM hr.companies WHERE id='legacy'`)).rows[0];
      expect(after).toEqual(before); // existing company untouched: hours are NOT rewritten
      await c.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ('fresh','Fresh Co',now())`);
      expect((await c.query(`SELECT "workEndTime" FROM hr.companies WHERE id='fresh'`)).rows[0].workEndTime).toBe('18:00');
      expect((await c.query('SELECT count(*)::int AS n FROM hr.holidays')).rows[0].n).toBe(0);
    } finally {
      await c.query('ROLLBACK');
    }
    // and the real schema is intact afterwards
    expect((await c.query(`SELECT to_regclass('hr.holidays') IS NOT NULL AS ok`)).rows[0].ok).toBe(true);
  });
});
