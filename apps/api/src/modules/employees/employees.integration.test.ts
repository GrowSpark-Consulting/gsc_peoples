/* eslint-disable @typescript-eslint/no-explicit-any -- supertest bodies are untyped JSON */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '@gsc/contracts';
import { createApp } from '../../app';
import { createPrismaClient } from '../../database/client';
import type { PrismaClient } from '../../database/generated/client';
import { createIdentityStore } from '../../database/identity';
import { createTenantRunner } from '../../database/tenant';
import type { CentralAuthProvider } from '../../integrations/central-auth';
import { UnauthorizedError } from '../../shared/errors';
import { connect, testUrl } from '../../test/integration/helpers';
import { insertCompany, insertDepartment, insertRole, insertUser, resetData } from '../../test/integration/seed';

/**
 * Real PostgreSQL (hr_test) integration tests for the Employee API.
 * Real: the Express app, validation, authorisation, repository, tenant layer, Prisma client connected
 * as the least-privilege `hr_app` role, membership/role/permission lookup, constraints, indexes and
 * the manager-cycle trigger. Stubbed: only the Central Authentication token check (no SSO exists yet).
 * Fixtures are inserted as `hr_migrator`. Nothing here can reach hr_db (see test/integration/helpers.ts).
 */

const A = 'cA';
const B = 'cB';
const P = PERMISSIONS;

const provider: CentralAuthProvider = {
  kind: 'development',
  verifyToken: (token) => {
    const [prefix, externalId, companyId] = token.split(':');
    if (prefix !== 't' || !externalId || !companyId) return Promise.reject(new UnauthorizedError('bad token'));
    return Promise.resolve({ externalId, companyId });
  },
  resolveAccess: () => Promise.resolve({ roles: [], permissions: [] }),
  syncUser: () => Promise.resolve(),
};

let admin: pg.Client; // hr_migrator: fixtures and assertions
let appDb: pg.Client; // hr_app: proves what the runtime role may and may not do
let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

const tok = (user: string, company = A) => `t:${user}:${company}`;
const call = (method: 'get' | 'post' | 'patch' | 'put', user: string, url: string, body?: unknown, company = A) => {
  const req = (request(app) as any)[method](`/api/v1${url}`).set('authorization', `Bearer ${tok(user, company)}`);
  return body === undefined ? req : req.send(body);
};

interface Emp { id: string; number: string; first: string; last: string; email?: string | null; dept?: string | null; mgr?: string | null; status?: string; type?: string; hire?: string | null }

async function insertEmp(company: string, e: Emp) {
  await admin.query(
    `INSERT INTO hr.employees (id, "companyId", "employeeNumber", "firstName", "lastName", "workEmail", "employmentType", status, "hireDate", "departmentId", "managerId", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
    [e.id, company, e.number, e.first, e.last, e.email ?? null, e.type ?? 'FULL_TIME', e.status ?? 'ACTIVE', e.hire ?? null, e.dept ?? null, e.mgr ?? null],
  );
}

async function giveRole(company: string, roleId: string, key: string, perms: readonly string[]) {
  await insertRole(admin, roleId, company, key);
  for (const p of perms) {
    await admin.query('INSERT INTO hr.role_permissions (id, "companyId", "roleId", permission) VALUES ($1,$2,$3,$4)', [randomUUID(), company, roleId, p]);
  }
}

async function member(userId: string, company: string, roleId: string, employeeId: string | null, status = 'ACTIVE') {
  await admin.query(
    `INSERT INTO hr.company_memberships (id, "companyId", "userId", "roleId", "employeeId", status, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [randomUUID(), company, userId, roleId, employeeId, status],
  );
}

const ID = {
  hr: randomUUID(), mgr: randomUUID(), r1: randomUUID(), r2: randomUUID(), grand: randomUUID(), peer: randomUUID(), eve: randomUUID(),
  lower: randomUUID(), accent: randomUUID(), apostrophe: randomUUID(),
  bob: randomUUID(), boss: randomUUID(),
  eng: randomUUID(), sales: randomUUID(), deptB: randomUUID(),
};
/** Fields the create contract requires beyond name and number (PRD EMP-001): work email, joining date, department. */
let seq = 0;
const required = (departmentId: string = ID.eng) => ({ workEmail: `new${++seq}@corp.test`, joiningDate: '2026-01-05', departmentId });

async function seed() {
  await resetData(admin);
  await insertCompany(admin, A);
  await insertCompany(admin, B);
  for (const u of ['u-hr', 'u-hr-nostatus', 'u-mgr', 'u-emp', 'u-hrb', 'u-invited', 'u-bogus', 'u-stranger']) await insertUser(admin, u);
  await insertUser(admin, 'u-disabled');
  await admin.query("UPDATE hr.users SET status='DISABLED' WHERE id='u-disabled'");

  await insertDepartment(admin, ID.eng, A, 'Engineering');
  await insertDepartment(admin, ID.sales, A, 'Sales');
  await insertDepartment(admin, ID.deptB, B, 'Other Co Dept');

  await insertEmp(A, { id: ID.hr, number: 'EMP-001', first: 'Hana', last: 'Admin' });
  await insertEmp(A, { id: ID.mgr, number: 'EMP-002', first: 'Mia', last: 'Manager', dept: ID.eng });
  await insertEmp(A, { id: ID.r1, number: 'EMP-003', first: 'Ravi', last: 'Reddy', mgr: ID.mgr, dept: ID.eng, hire: '2020-01-01', email: 'ravi@a.test' });
  await insertEmp(A, { id: ID.r2, number: 'EMP-004', first: 'Sara', last: 'Singh', mgr: ID.mgr, dept: ID.sales, status: 'ONBOARDING', type: 'CONTRACT' });
  await insertEmp(A, { id: ID.grand, number: 'EMP-005', first: 'Gita', last: 'Grand', mgr: ID.r1 });
  await insertEmp(A, { id: ID.peer, number: 'EMP-006', first: 'Paul', last: 'Peer' });
  await insertEmp(A, { id: ID.eve, number: 'EMP-007', first: 'Eve', last: 'Employee' });
  // ordering stress: lower-case, accented and punctuated surnames
  await insertEmp(A, { id: ID.lower, number: 'EMP-008', first: 'Abel', last: 'abel' });
  await insertEmp(A, { id: ID.accent, number: 'EMP-009', first: 'Edith', last: 'Édouard' });
  await insertEmp(A, { id: ID.apostrophe, number: 'EMP-010', first: 'Oona', last: "O'Brien" });
  await insertEmp(B, { id: ID.bob, number: 'EMP-001', first: 'Bob', last: 'Other', dept: ID.deptB });
  await insertEmp(B, { id: ID.boss, number: 'EMP-002', first: 'Bea', last: 'Boss' });

  for (const c of [A, B]) {
    await giveRole(c, `HR-${c}`, 'HR_ADMIN', ROLE_DEFAULT_PERMISSIONS.HR_ADMIN);
    await giveRole(c, `MGR-${c}`, 'MANAGER', ROLE_DEFAULT_PERMISSIONS.MANAGER);
    await giveRole(c, `EMP-${c}`, 'EMPLOYEE', ROLE_DEFAULT_PERMISSIONS.EMPLOYEE);
  }
  await giveRole(A, 'HRNS-A', 'HR_NOSTATUS', [P.EMPLOYEE_READ_ALL, P.EMPLOYEE_WRITE]);
  await giveRole(A, 'BOGUS-A', 'BOGUS', ['employee:everything', 'nonsense']);

  await member('u-hr', A, 'HR-cA', ID.hr);
  await member('u-hr-nostatus', A, 'HRNS-A', null); // an employee profile maps to at most one membership
  await member('u-mgr', A, 'MGR-cA', ID.mgr);
  await member('u-emp', A, 'EMP-cA', ID.eve);
  await member('u-bogus', A, 'BOGUS-A', null);
  await member('u-invited', A, 'HR-cA', null, 'INVITED');
  await member('u-disabled', A, 'HR-cA', null);
  await member('u-hrb', B, 'HR-cB', ID.boss);
}

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  appDb = await connect('TEST_DATABASE_URL');
  prisma = createPrismaClient(testUrl('TEST_DATABASE_URL'), { max: 6 });
  const identity = createIdentityStore(prisma);
  app = createApp({
    authProvider: provider,
    resolveMembership: (i) => identity.resolveActiveMembership(i),
    tenantRunner: createTenantRunner(prisma),
  });
});
afterAll(async () => {
  await prisma?.$disconnect();
  await appDb?.end();
  await admin?.end();
});
beforeEach(seed);

const auditRows = async (employeeId?: string) =>
  (await admin.query(
    `SELECT "companyId", "employeeId", "actorUserId", action, changes FROM hr.employee_audit_logs ${employeeId ? 'WHERE "employeeId"=$1' : ''} ORDER BY "createdAt", id`,
    employeeId ? [employeeId] : [],
  )).rows;
const lastNames = (res: request.Response) => (res.body.data as any[]).map((e) => e.lastName);

describe('company and permissions come from real membership rows', () => {
  it('ACTIVE membership of an ACTIVE user works; everything else is 403', async () => {
    expect((await call('get', 'u-hr', '/employees')).status).toBe(200);
    expect((await call('get', 'u-invited', '/employees')).status).toBe(403); // membership INVITED
    expect((await call('get', 'u-disabled', '/employees')).status).toBe(403); // user DISABLED
    expect((await call('get', 'u-stranger', '/employees')).status).toBe(403); // no membership at all
    expect((await call('get', 'u-hr', '/employees', undefined, B)).status).toBe(403); // token says B, membership only in A
    expect((await request(app).get('/api/v1/employees')).status).toBe(401);
  });

  it('suspending or revoking a membership takes effect immediately', async () => {
    expect((await call('get', 'u-mgr', '/employees')).status).toBe(200);
    await admin.query("UPDATE hr.company_memberships SET status='SUSPENDED' WHERE \"userId\"='u-mgr'");
    expect((await call('get', 'u-mgr', '/employees')).status).toBe(403);
    await admin.query("UPDATE hr.company_memberships SET status='ACTIVE' WHERE \"userId\"='u-mgr'");
    expect((await call('get', 'u-mgr', '/employees')).status).toBe(200);
  });

  it('unknown role keys grant nothing (fail closed), whatever permission rows they carry', async () => {
    expect((await call('get', 'u-bogus', '/employees')).status).toBe(403);
    expect((await call('get', 'u-hr-nostatus', '/employees')).status).toBe(403); // role key HR_NOSTATUS is not one of the four
  });

  it('permissions are code-defined per role (PRD SET-003): role_permissions rows neither grant nor revoke', async () => {
    const body = (n: string) => ({ ...required(), employeeNumber: n, firstName: 'A', lastName: 'B' });
    // revoking the row does not remove HR's access ...
    await admin.query(`DELETE FROM hr.role_permissions WHERE "roleId"='HR-cA' AND permission=$1`, [P.EMPLOYEE_WRITE]);
    expect((await call('post', 'u-hr', '/employees', body('EMP-050'))).status).toBe(201);
    // ... and adding a row does not give an Employee write access.
    await admin.query('INSERT INTO hr.role_permissions (id, "companyId", "roleId", permission) VALUES ($1,$2,$3,$4)', [randomUUID(), A, 'EMP-cA', P.EMPLOYEE_WRITE]);
    expect((await call('post', 'u-emp', '/employees', body('EMP-051'))).status).toBe(403);
  });
});

describe('role views (real API responses)', () => {
  it('HR Admin: whole company A, never company B', async () => {
    const res = await call('get', 'u-hr', '/employees?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.map((e: any) => e.id)).not.toContain(ID.bob);
  });

  it('Manager: direct and indirect reports and self only (PRD section 5); others are 404', async () => {
    const res = await call('get', 'u-mgr', '/employees?limit=100');
    expect(lastNames(res)).toEqual(['Grand', 'Manager', 'Reddy', 'Singh']);
    expect((await call('get', 'u-mgr', `/employees/${ID.r1}`)).status).toBe(200);
    expect((await call('get', 'u-mgr', `/employees/${ID.grand}`)).status).toBe(200); // grand-report
    expect((await call('get', 'u-mgr', `/employees/${ID.peer}`)).status).toBe(404);
  });

  it('Employee: own profile only', async () => {
    expect(lastNames(await call('get', 'u-emp', '/employees'))).toEqual(['Employee']);
    expect((await call('get', 'u-emp', `/employees/${ID.hr}`)).status).toBe(404);
  });

  it('only SA/HR may write or change status; managers and employees get 403', async () => {
    const body = { ...required(), employeeNumber: 'EMP-060', firstName: 'A', lastName: 'B' };
    expect((await call('post', 'u-mgr', '/employees', body)).status).toBe(403);
    expect((await call('post', 'u-emp', '/employees', body)).status).toBe(403);
    expect((await call('patch', 'u-emp', `/employees/${ID.eve}`, { jobTitle: 'CEO' })).status).toBe(403);
    expect((await call('put', 'u-mgr', `/employees/${ID.r1}/status`, { status: 'ON_LEAVE' })).status).toBe(403);
    expect((await call('put', 'u-hr', `/employees/${ID.r1}/status`, { status: 'ON_LEAVE' })).status).toBe(200);
    const stored = await admin.query('SELECT "jobTitle" FROM hr.employees WHERE id=$1', [ID.eve]);
    expect(stored.rows[0].jobTitle).toBeNull();
  });

  it('departments: only the caller company; every role may view', async () => {
    const res = await call('get', 'u-hr', '/departments');
    expect(res.body.data.map((d: any) => d.name)).toEqual(['Engineering', 'Sales']);
    expect((await call('get', 'u-emp', '/departments')).status).toBe(200); // PRD ORG-002: every role may view
  });
});

describe('tenant isolation against real constraints', () => {
  it('company A cannot see or change company B rows (404) and nothing is written', async () => {
    expect((await call('get', 'u-hr', `/employees/${ID.bob}`)).status).toBe(404);
    expect((await call('patch', 'u-hr', `/employees/${ID.bob}`, { jobTitle: 'x' })).status).toBe(404);
    expect((await call('put', 'u-hr', `/employees/${ID.bob}/status`, { status: 'ON_LEAVE' })).status).toBe(404);
    expect((await admin.query('SELECT "jobTitle", status FROM hr.employees WHERE id=$1', [ID.bob])).rows[0]).toEqual({ jobTitle: null, status: 'ACTIVE' });
    expect(await auditRows()).toHaveLength(0);
  });

  it("company A cannot assign company B's department or manager (404), and the database would refuse it too", async () => {
    const base = { ...required(), employeeNumber: 'EMP-070', firstName: 'N', lastName: 'Hire' };
    expect((await call('post', 'u-hr', '/employees', { ...base, departmentId: ID.deptB })).status).toBe(404);
    expect((await call('post', 'u-hr', '/employees', { ...base, managerId: ID.bob })).status).toBe(404);
    expect((await call('patch', 'u-hr', `/employees/${ID.peer}`, { managerId: ID.bob })).status).toBe(404);
    // the composite FK is the backstop even if application code were wrong:
    await expect(admin.query('UPDATE hr.employees SET "departmentId"=$1 WHERE id=$2', [ID.deptB, ID.peer])).rejects.toMatchObject({ code: '23503' });
  });

  it('the same employee number and email can exist in two companies, never twice in one', async () => {
    expect((await call('post', 'u-hrb', '/employees', { ...required(ID.deptB), employeeNumber: 'emp-077', firstName: 'B', lastName: 'New', workEmail: 'x@y.test' }, B)).status).toBe(201);
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'emp-077', firstName: 'A', lastName: 'New', workEmail: 'x@y.test' })).status).toBe(201);
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'EMP-077', firstName: 'A', lastName: 'Two' })).status).toBe(409);
  });

  it('companyId in a body or query is rejected, not ignored', async () => {
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'EMP-080', firstName: 'A', lastName: 'B', companyId: B })).status).toBe(400);
    expect((await call('get', 'u-hr', `/employees?companyId=${B}`)).status).toBe(400);
  });
});

describe('pagination, search and filters on PostgreSQL', () => {
  it('keyset pages match PostgreSQL ORDER BY exactly (collation, case, accents, apostrophes), no gaps or repeats', async () => {
    const expected = (await admin.query('SELECT id FROM hr.employees WHERE "companyId"=$1 ORDER BY "lastName", "firstName", id', [A])).rows.map((r) => r.id);
    const got: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res: request.Response = await call('get', 'u-hr', `/employees?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      got.push(...res.body.data.map((e: any) => e.id));
      cursor = res.body.page.nextCursor;
      if (!cursor) break;
    }
    expect(got).toEqual(expected);
    expect(new Set(got).size).toBe(10);
  });

  it('a page boundary that lands exactly on the last row gives no phantom page', async () => {
    const res = await call('get', 'u-hr', '/employees?limit=10');
    expect(res.body.data).toHaveLength(10);
    expect(res.body.page.nextCursor).toBeNull();
  });

  it('search is case-insensitive over name, number and email; every word must match', async () => {
    expect(lastNames(await call('get', 'u-hr', '/employees?q=REDDY'))).toEqual(['Reddy']);
    expect(lastNames(await call('get', 'u-hr', '/employees?q=ravi%20reddy'))).toEqual(['Reddy']);
    expect(lastNames(await call('get', 'u-hr', '/employees?q=emp-004'))).toEqual(['Singh']);
    expect(lastNames(await call('get', 'u-hr', '/employees?q=ravi@a.test'))).toEqual(['Reddy']);
    expect(lastNames(await call('get', 'u-hr', '/employees?q=ravi%20singh'))).toEqual([]);
    expect(lastNames(await call('get', 'u-hr', "/employees?q=o'brien"))).toEqual(["O'Brien"]);
  });

  it('SQL wildcard characters in the search box are literal text, not patterns', async () => {
    expect((await call('get', 'u-hr', '/employees?q=%25')).body.data).toHaveLength(0); // "%"
    expect((await call('get', 'u-hr', '/employees?q=_')).body.data).toHaveLength(0); // "_"
    expect((await call('get', 'u-hr', '/employees?q=r%25y')).body.data).toHaveLength(0); // "r%y" must not match "Reddy"
  });

  it('filters (status, type, department, manager) agree with SQL', async () => {
    const count = async (sql: string, args: unknown[] = []) => Number((await admin.query(sql, args)).rows[0].n);
    const onb = await call('get', 'u-hr', '/employees?status=ONBOARDING');
    expect(onb.body.data).toHaveLength(await count(`SELECT count(*) n FROM hr.employees WHERE "companyId"='cA' AND status='ONBOARDING'`));
    const contract = await call('get', 'u-hr', '/employees?employmentType=CONTRACT');
    expect(lastNames(contract)).toEqual(['Singh']);
    const dept = await call('get', 'u-hr', `/employees?departmentId=${ID.eng}`);
    expect(dept.body.data).toHaveLength(await count(`SELECT count(*) n FROM hr.employees WHERE "departmentId"=$1`, [ID.eng]));
    expect(lastNames(await call('get', 'u-hr', `/employees?managerId=${ID.mgr}`))).toEqual(['Reddy', 'Singh']);
    expect(lastNames(await call('get', 'u-hr', '/employees?status=ACTIVE,ONBOARDING&employmentType=CONTRACT'))).toEqual(['Singh']);
    expect((await call('get', 'u-hr', `/employees?departmentId=${ID.deptB}`)).body.data).toHaveLength(0);
  });
});

describe('create, edit and status end-to-end (real constraints, real audit rows)', () => {
  it('create: normalises, defaults to ONBOARDING, writes a CREATED audit row for the actor', async () => {
    const res = await call('post', 'u-hr', '/employees', {
      employeeNumber: ' emp-100 ', firstName: 'Nina', lastName: 'North', workEmail: ' Nina.North@Corp.TEST ',
      jobTitle: 'Analyst', joiningDate: '2026-02-01', departmentId: ID.eng, managerId: ID.mgr, employmentType: 'CONTRACT',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ employeeNumber: 'EMP-100', workEmail: 'nina.north@corp.test', status: 'ONBOARDING', employmentType: 'CONTRACT', joiningDate: '2026-02-01', hireDate: '2026-02-01', department: { name: 'Engineering' }, manager: { id: ID.mgr } });
    const stored = (await admin.query('SELECT "companyId", "employeeNumber", "workEmail" FROM hr.employees WHERE id=$1', [res.body.data.id])).rows[0];
    expect(stored).toEqual({ companyId: A, employeeNumber: 'EMP-100', workEmail: 'nina.north@corp.test' });
    const audit = await auditRows(res.body.data.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ companyId: A, actorUserId: 'u-hr', action: 'CREATED' });
  });

  it('duplicate number or email is 409, case-insensitively; sequential and concurrent', async () => {
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'emp-001', firstName: 'D', lastName: 'Up' })).status).toBe(409);
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'EMP-101', firstName: 'D', lastName: 'Up', workEmail: 'RAVI@A.TEST' })).status).toBe(409);
    // two simultaneous creates of the same number: exactly one wins, the loser is a clean 409 (unique index + P2002 mapping)
    const results = await Promise.all([1, 2, 3, 4].map((i) => call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'EMP-RACE', firstName: `R${i}`, lastName: 'Race', workEmail: `race${i}@a.test` })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(Number((await admin.query(`SELECT count(*) n FROM hr.employees WHERE "employeeNumber"='EMP-RACE'`)).rows[0].n)).toBe(1);
  });

  it('edit: one audit entry per kind of change; no-op edits write nothing', async () => {
    const res = await call('patch', 'u-hr', `/employees/${ID.peer}`, { jobTitle: 'Lead', departmentId: ID.sales, managerId: ID.mgr });
    expect(res.status).toBe(200);
    expect((await auditRows(ID.peer)).map((a) => a.action).sort()).toEqual(['DEPARTMENT_CHANGED', 'MANAGER_CHANGED', 'UPDATED']);
    expect((await auditRows(ID.peer)).find((a) => a.action === 'DEPARTMENT_CHANGED')?.changes).toEqual({ departmentId: { from: null, to: ID.sales } });
    const before = (await auditRows()).length;
    expect((await call('patch', 'u-hr', `/employees/${ID.peer}`, { jobTitle: 'Lead', managerId: ID.mgr })).status).toBe(200);
    expect((await auditRows()).length).toBe(before);
  });

  it('status: TERMINATED needs a date on/after hire (also enforced by CHECK); reactivation clears it', async () => {
    expect((await call('put', 'u-hr', `/employees/${ID.r1}/status`, { status: 'TERMINATED' })).status).toBe(400);
    expect((await call('put', 'u-hr', `/employees/${ID.r1}/status`, { status: 'TERMINATED', terminationDate: '2019-12-31' })).status).toBe(400);
    const t = await call('put', 'u-hr', `/employees/${ID.r1}/status`, { status: 'TERMINATED', terminationDate: '2026-06-30' });
    expect(t.body.data).toMatchObject({ status: 'TERMINATED', terminationDate: '2026-06-30' });
    const back = await call('put', 'u-hr', `/employees/${ID.r1}/status`, { status: 'ACTIVE' });
    expect(back.body.data).toMatchObject({ status: 'ACTIVE', terminationDate: null });
    expect((await auditRows(ID.r1)).filter((a) => a.action === 'STATUS_CHANGED')).toHaveLength(2);
    // the database refuses the same state even if the API did not
    await expect(admin.query(`UPDATE hr.employees SET status='TERMINATED', "terminationDate"=NULL WHERE id=$1`, [ID.peer])).rejects.toMatchObject({ code: '23514' });
  });

  it('a terminated employee cannot be assigned as manager, against real data', async () => {
    expect((await call('put', 'u-hr', `/employees/${ID.r2}/status`, { status: 'TERMINATED', terminationDate: '2026-06-30' })).status).toBe(200);
    expect((await call('patch', 'u-hr', `/employees/${ID.peer}`, { managerId: ID.r2 })).status).toBe(400);
    expect((await call('post', 'u-hr', '/employees', { ...required(), employeeNumber: 'EMP-121', firstName: 'N', lastName: 'Hire', managerId: ID.r2 })).status).toBe(400);
    expect((await call('patch', 'u-hr', `/employees/${ID.peer}`, { managerId: ID.mgr })).status).toBe(200);
  });

  it('manager cycles: refused by the API; refused by the trigger even when a race gets past the API check', async () => {
    expect((await call('patch', 'u-hr', `/employees/${ID.mgr}`, { managerId: ID.grand })).status).toBe(400); // mgr -> grand -> r1 -> mgr
    expect((await call('patch', 'u-hr', `/employees/${ID.mgr}`, { managerId: ID.mgr })).status).toBe(400);
    // concurrent opposite assignments between two unmanaged people: at most one may succeed, and no cycle survives
    const [x, y] = [ID.peer, ID.eve];
    const res = await Promise.all([
      call('patch', 'u-hr', `/employees/${x}`, { managerId: y }),
      call('patch', 'u-hr', `/employees/${y}`, { managerId: x }),
    ]);
    const statuses = res.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    expect(statuses.every((s) => s < 500), `no 500s expected, got ${statuses} ${JSON.stringify(res.map((r) => r.body.error?.code))}`).toBe(true);
    const rows = (await admin.query('SELECT id, "managerId" FROM hr.employees WHERE id = ANY($1)', [[x, y]])).rows;
    expect(rows.every((r) => r.managerId === null) || rows.filter((r) => r.managerId !== null).length === 1).toBe(true);
  });

  it('audit log is append-only for the runtime role (hr_app: INSERT/SELECT yes, UPDATE/DELETE/TRUNCATE no)', async () => {
    await call('patch', 'u-hr', `/employees/${ID.peer}`, { jobTitle: 'Lead' });
    expect((await auditRows()).length).toBe(1);
    await expect(appDb.query(`UPDATE hr.employee_audit_logs SET action='CREATED'`)).rejects.toMatchObject({ code: '42501' });
    await expect(appDb.query(`DELETE FROM hr.employee_audit_logs`)).rejects.toMatchObject({ code: '42501' });
    await expect(appDb.query(`TRUNCATE hr.employee_audit_logs`)).rejects.toMatchObject({ code: '42501' });
    expect((await auditRows()).length).toBe(1);
  });

  it('a failed write leaves neither the change nor an audit row (one transaction)', async () => {
    // Make the audit insert fail (unknown actor) by deleting the acting user's row mid-flight is not
    // possible through the API, so provoke a failure AFTER the employee row is written: duplicate email on update.
    const before = (await admin.query('SELECT "jobTitle", "workEmail" FROM hr.employees WHERE id=$1', [ID.peer])).rows[0];
    const res = await call('patch', 'u-hr', `/employees/${ID.peer}`, { jobTitle: 'Changed', workEmail: 'ravi@a.test' });
    expect(res.status).toBe(409);
    expect((await admin.query('SELECT "jobTitle", "workEmail" FROM hr.employees WHERE id=$1', [ID.peer])).rows[0]).toEqual(before);
    expect(await auditRows()).toHaveLength(0);
  });
});
