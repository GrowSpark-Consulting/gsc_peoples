import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, employeeListResponseSchema } from '@gsc/contracts';
import { createApp } from '../../app';
import { createTenantRunner } from '../../database/tenant';
import type { CentralAuthProvider } from '../../integrations/central-auth';
import type { MembershipResolver } from '../../middleware/auth/resolve-tenant';
import { UnauthorizedError } from '../../shared/errors';
import { createFakePrisma, type FakeDb } from './testing/fake-prisma';

const A = 'company-a';
const B = 'company-b';

/** Test identity provider: token `t:<externalId>:<companyId>`. Stands in for Central Authentication. */
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

const P = PERMISSIONS;
const HR_PERMS = [...ROLE_DEFAULT_PERMISSIONS.HR_ADMIN];

type Seed = ReturnType<typeof seed>;

function seed(fake: FakeDb) {
  const now = new Date('2026-01-01T00:00:00Z');
  const dept = (companyId: string, name: string) => {
    const row = { id: randomUUID(), companyId, name, isActive: true, createdAt: now, updatedAt: now };
    fake.tables.department.push(row);
    return row;
  };
  const emp = (companyId: string, n: string, first: string, last: string, extra: Record<string, unknown> = {}) => {
    const row = {
      id: randomUUID(), companyId, employeeNumber: n, firstName: first, lastName: last,
      workEmail: `${first}.${last}@${companyId}.test`.toLowerCase(), jobTitle: null,
      employmentType: 'FULL_TIME', status: 'ACTIVE', hireDate: null, terminationDate: null,
      departmentId: null, managerId: null, createdAt: now, updatedAt: now, ...extra,
    };
    fake.tables.employee.push(row);
    return row as typeof row & { id: string };
  };
  const eng = dept(A, 'Engineering');
  const sales = dept(A, 'Sales');
  const deptB = dept(B, 'Other Co Dept');
  const engineer = { id: randomUUID(), companyId: A, name: 'Engineer', isActive: true, createdAt: now, updatedAt: now };
  fake.tables.designation.push(engineer);
  const engineerB = { ...engineer, id: randomUUID(), companyId: B };
  fake.tables.designation.push(engineerB);

  const hr = emp(A, 'EMP-001', 'Hana', 'Admin');
  const mgr = emp(A, 'EMP-002', 'Mia', 'Manager', { departmentId: eng.id });
  const r1 = emp(A, 'EMP-003', 'Ravi', 'Reddy', { managerId: mgr.id, departmentId: eng.id, hireDate: new Date('2020-01-01T00:00:00Z') });
  const r2 = emp(A, 'EMP-004', 'Sara', 'Singh', { managerId: mgr.id, departmentId: sales.id, status: 'ONBOARDING', joiningDate: new Date('2026-01-01T00:00:00Z'), address: '9 Private Road', emergencyContact: 'Private Person' });
  const grand = emp(A, 'EMP-005', 'Gita', 'Grand', { managerId: r1.id });
  const peer = emp(A, 'EMP-006', 'Paul', 'Peer');
  const eve = emp(A, 'EMP-007', 'Eve', 'Employee');
  const bob = emp(B, 'EMP-001', 'Bob', 'Other', { departmentId: deptB.id });
  const bobBoss = emp(B, 'EMP-002', 'Bea', 'Boss');
  return { eng, sales, deptB, engineer, engineerB, hr, mgr, r1, r2, grand, peer, eve, bob, bobBoss };
}

interface Member { userId: string; employeeId: string | null; roleKey: string; permissions: string[] }

describe('Employee API', () => {
  let fake: FakeDb;
  let s: Seed;
  let app: ReturnType<typeof createApp>;
  let members: Map<string, Member>;

  const as = (token: string) => (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  const get = (token: string, url: string) => as(token)(request(app).get(`/api/v1${url}`));
  const post = (token: string, url: string, body: unknown) => as(token)(request(app).post(`/api/v1${url}`)).send(body as object);
  const patch = (token: string, url: string, body: unknown) => as(token)(request(app).patch(`/api/v1${url}`)).send(body as object);
  const put = (token: string, url: string, body: unknown) => as(token)(request(app).put(`/api/v1${url}`)).send(body as object);

  beforeEach(() => {
    fake = createFakePrisma();
    s = seed(fake);
    members = new Map<string, Member>([
      [`u-hr|${A}`, { userId: 'user-hr', employeeId: s.hr.id, roleKey: 'HR_ADMIN', permissions: HR_PERMS }],
      [`u-sa|${A}`, { userId: 'user-sa', employeeId: null, roleKey: 'SUPER_ADMIN', permissions: [...ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN] }],
      [`u-hr-nostatus|${A}`, { userId: 'user-hr2', employeeId: s.hr.id, roleKey: 'HR_ADMIN', permissions: [P.EMPLOYEE_READ_ALL, P.EMPLOYEE_WRITE] }],
      [`u-mgr|${A}`, { userId: 'user-mgr', employeeId: s.mgr.id, roleKey: 'MANAGER', permissions: [...ROLE_DEFAULT_PERMISSIONS.MANAGER] }],
      [`u-emp|${A}`, { userId: 'user-emp', employeeId: s.eve.id, roleKey: 'EMPLOYEE', permissions: [...ROLE_DEFAULT_PERMISSIONS.EMPLOYEE] }],
      [`u-unlinked|${A}`, { userId: 'user-unl', employeeId: null, roleKey: 'MANAGER', permissions: [...ROLE_DEFAULT_PERMISSIONS.MANAGER] }],
      [`u-bogus|${A}`, { userId: 'user-bogus', employeeId: null, roleKey: 'HR_ADMIN', permissions: ['employee:everything', 'nonsense'] }],
      [`u-hrb|${B}`, { userId: 'user-hrb', employeeId: s.bobBoss.id, roleKey: 'HR_ADMIN', permissions: HR_PERMS }],
    ]);
    const resolveMembership: MembershipResolver = ({ externalId, companyId }) => {
      const m = members.get(`${externalId}|${companyId}`);
      return Promise.resolve(m ? { membershipId: `m-${m.userId}`, ...m } : null);
    };
    app = createApp({ authProvider: provider, resolveMembership, tenantRunner: createTenantRunner(fake.prisma) });
  });

  const hr = `t:u-hr:${A}`;
  const mgr = `t:u-mgr:${A}`;
  const emp = `t:u-emp:${A}`;
  /** Fields the create endpoint requires beyond the name (PRD EMP-001): work email, joining date, department, designation. */
  const required = (departmentId = s.eng.id) => ({ workEmail: `${randomUUID()}@corp.test`, joiningDate: '2026-01-05', departmentId, designationId: s.engineer.id });
  const lastNames = (res: request.Response) => (res.body.data as { lastName: string }[]).map((e) => e.lastName);

  describe('authentication and company resolution', () => {
    it('401 without a token', async () => {
      expect((await request(app).get('/api/v1/employees')).status).toBe(401);
    });

    it('403 when the user has no ACTIVE membership in the token company', async () => {
      expect((await get('t:stranger:' + A, '/employees')).status).toBe(403);
      // valid user of company A whose token claims company B: no membership there -> refused
      expect((await get(`t:u-hr:${B}`, '/employees')).status).toBe(403);
    });

    it('ignores company hints in headers, query and body (company comes from the membership)', async () => {
      const res = await as(hr)(request(app).get('/api/v1/employees').set('x-company-id', B).set('x-tenant-id', B));
      expect(res.status).toBe(200);
      expect(res.body.data.every((e: { id: string }) => e.id !== s.bob.id)).toBe(true);
      expect((await get(hr, `/employees?companyId=${B}`)).status).toBe(400); // unknown query key rejected
      expect((await post(hr, '/employees', { ...required(), employeeNumber: 'X1', firstName: 'A', lastName: 'B', companyId: B })).status).toBe(400);
    });

    it('drops permission strings that are not in the registry', async () => {
      expect((await get(`t:u-bogus:${A}`, '/employees')).status).toBe(403);
    });
  });

  describe('list, pagination, search and filters', () => {
    it('lists only the caller company, ordered by last name, first name, id', async () => {
      const res = await get(hr, '/employees?limit=100');
      expect(res.status).toBe(200);
      employeeListResponseSchema.parse(res.body);
      expect(lastNames(res)).toEqual(['Admin', 'Employee', 'Grand', 'Manager', 'Peer', 'Reddy', 'Singh']);
      expect(res.body.page.nextCursor).toBeNull();
    });

    it('paginates with an opaque cursor without gaps or repeats', async () => {
      const p1 = await get(hr, '/employees?limit=3');
      expect(lastNames(p1)).toEqual(['Admin', 'Employee', 'Grand']);
      expect(typeof p1.body.page.nextCursor).toBe('string');
      const p2 = await get(hr, `/employees?limit=3&cursor=${encodeURIComponent(p1.body.page.nextCursor)}`);
      expect(lastNames(p2)).toEqual(['Manager', 'Peer', 'Reddy']);
      const p3 = await get(hr, `/employees?limit=3&cursor=${encodeURIComponent(p2.body.page.nextCursor)}`);
      expect(lastNames(p3)).toEqual(['Singh']);
      expect(p3.body.page.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor, an oversized limit and unknown params', async () => {
      expect((await get(hr, '/employees?cursor=not-a-cursor')).status).toBe(400);
      expect((await get(hr, '/employees?limit=101')).status).toBe(400);
      expect((await get(hr, '/employees?limit=0')).status).toBe(400);
      expect((await get(hr, '/employees?salary=1')).status).toBe(400);
    });

    it('searches name, employee number and email; every word must match', async () => {
      expect(lastNames(await get(hr, '/employees?q=ravi'))).toEqual(['Reddy']);
      expect(lastNames(await get(hr, '/employees?q=reddy%20ravi'))).toEqual(['Reddy']);
      expect(lastNames(await get(hr, '/employees?q=emp-004'))).toEqual(['Singh']);
      expect(lastNames(await get(hr, '/employees?q=sara.singh@'))).toEqual(['Singh']);
      expect(lastNames(await get(hr, '/employees?q=ravi%20singh'))).toEqual([]);
    });

    it('filters by status, department and manager', async () => {
      expect(lastNames(await get(hr, '/employees?status=ONBOARDING'))).toEqual(['Singh']);
      expect(lastNames(await get(hr, `/employees?departmentId=${s.eng.id}`))).toEqual(['Manager', 'Reddy']);
      expect(lastNames(await get(hr, `/employees?managerId=${s.mgr.id}`))).toEqual(['Reddy', 'Singh']);
      expect(lastNames(await get(hr, `/employees?status=ACTIVE,ONBOARDING&departmentId=${s.sales.id}`))).toEqual(['Singh']);
      // a department id from another company simply matches nothing
      expect(lastNames(await get(hr, `/employees?departmentId=${s.deptB.id}`))).toEqual([]);
    });
  });

  describe('read scope', () => {
    it('manager sees direct AND indirect reports and self only (PRD section 5; not peers or HR)', async () => {
      const res = await get(mgr, '/employees?limit=100');
      expect(lastNames(res)).toEqual(['Grand', 'Manager', 'Reddy', 'Singh']);
      expect((await get(mgr, `/employees/${s.r1.id}`)).status).toBe(200);
      expect((await get(mgr, `/employees/${s.mgr.id}`)).status).toBe(200);
      expect((await get(mgr, `/employees/${s.grand.id}`)).status).toBe(200); // grand-report: indirect
      expect((await get(mgr, `/employees/${s.peer.id}`)).status).toBe(404);
    });

    it('employee sees only their own record; others are 404', async () => {
      expect(lastNames(await get(emp, '/employees'))).toEqual(['Employee']);
      expect((await get(emp, `/employees/${s.eve.id}`)).status).toBe(200);
      expect((await get(emp, `/employees/${s.hr.id}`)).status).toBe(404);
    });

    it('a team/self user with no linked employee profile sees nothing', async () => {
      const res = await get(`t:u-unlinked:${A}`, '/employees');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns the profile with department and manager summaries', async () => {
      const res = await get(hr, `/employees/${s.r1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        employeeNumber: 'EMP-003',
        hireDate: '2020-01-01',
        department: { id: s.eng.id, name: 'Engineering' },
        manager: { id: s.mgr.id, firstName: 'Mia' },
      });
      expect(res.body.data).not.toHaveProperty('companyId');
    });
  });

  describe('tenant isolation (cross-company ids are 404)', () => {
    it('company A cannot read, edit or change status of company B employees', async () => {
      expect((await get(hr, `/employees/${s.bob.id}`)).status).toBe(404);
      expect((await patch(hr, `/employees/${s.bob.id}`, { jobTitle: 'x' })).status).toBe(404);
      expect((await put(hr, `/employees/${s.bob.id}/status`, { status: 'ACTIVE' })).status).toBe(404);
      expect(fake.tables.employee.find((e) => e.id === s.bob.id)?.jobTitle).toBeNull();
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
    });

    it("company A cannot assign company B's department or manager", async () => {
      const base = { ...required(), employeeNumber: 'EMP-900', firstName: 'N', lastName: 'Hire' };
      expect((await post(hr, '/employees', { ...base, departmentId: s.deptB.id })).status).toBe(404);
      expect((await post(hr, '/employees', { ...base, managerId: s.bob.id })).status).toBe(404);
      expect((await patch(hr, `/employees/${s.peer.id}`, { departmentId: s.deptB.id })).status).toBe(404);
      expect((await patch(hr, `/employees/${s.peer.id}`, { managerId: s.bob.id })).status).toBe(404);
      expect(fake.tables.employee.some((e) => e.employeeNumber === 'EMP-900')).toBe(false);
    });

    it('company B only sees its own people, and the same employee number can exist in both companies', async () => {
      const res = await get(`t:u-hrb:${B}`, '/employees');
      expect(lastNames(res)).toEqual(['Boss', 'Other']);
      expect((await post(`t:u-hrb:${B}`, '/employees', { ...required(s.deptB.id), designationId: s.engineerB.id, employeeNumber: 'emp-077', firstName: 'B', lastName: 'New' })).status).toBe(201);
      expect((await post(hr, '/employees', { ...required(), employeeNumber: 'emp-077', firstName: 'A', lastName: 'New' })).status).toBe(201);
    });

    it('every database call made for company A carries only company A', async () => {
      fake.calls.length = 0;
      await get(hr, '/employees?q=ra&status=ACTIVE&limit=2');
      await get(hr, `/employees/${s.r1.id}`);
      await post(hr, '/employees', { ...required(), employeeNumber: 'EMP-950', firstName: 'T', lastName: 'Scoped', managerId: s.mgr.id });
      await patch(hr, `/employees/${s.r2.id}`, { jobTitle: 'Lead', departmentId: s.eng.id, managerId: s.hr.id });
      await put(hr, `/employees/${s.r2.id}/status`, { status: 'ON_LEAVE' });
      await get(hr, '/departments');

      const found: unknown[] = [];
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v)) {
            if (k === 'companyId') found.push(val);
            walk(val);
          }
        }
      };
      expect(fake.calls.length).toBeGreaterThan(8);
      for (const call of fake.calls) {
        found.length = 0;
        walk(call.args);
        expect(found.length, `${call.model}.${call.operation} must carry companyId`).toBeGreaterThan(0);
        expect(new Set(found), `${call.model}.${call.operation}`).toEqual(new Set([A]));
      }
    });
  });

  describe('create', () => {
    it('creates with a manually entered number (stored upper-case), audits it, returns 201', async () => {
      const res = await post(hr, '/employees', {
        employeeNumber: ' emp-100 ', firstName: 'Nina', lastName: 'North', workEmail: ' Nina.North@Corp.TEST ',
        jobTitle: 'Analyst', joiningDate: '2026-02-01', departmentId: s.eng.id, managerId: s.mgr.id, designationId: s.engineer.id,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        employeeNumber: 'EMP-100', workEmail: 'nina.north@corp.test', status: 'ONBOARDING',
        employmentType: 'FULL_TIME', joiningDate: '2026-02-01', hireDate: '2026-02-01', department: { name: 'Engineering' }, // hireDate mirrors joiningDate
      });
      const audit = fake.tables.employeeAuditLog;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: A, action: 'CREATED', actorUserId: 'user-hr', employeeId: res.body.data.id });
    });

    it('409 on duplicate employee number (case-insensitive) or work email', async () => {
      const dup = await post(hr, '/employees', { ...required(), employeeNumber: 'emp-001', firstName: 'D', lastName: 'Up' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      const mail = await post(hr, '/employees', { ...required(), employeeNumber: 'EMP-101', firstName: 'D', lastName: 'Up', workEmail: 'RAVI.REDDY@company-a.test' });
      expect(mail.status).toBe(409);
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
    });

    it('rejects fields outside the approved schema and invalid values', async () => {
      const ok = { ...required(), employeeNumber: 'EMP-102', firstName: 'A', lastName: 'B' };
      for (const extra of [{ salary: 1 }, { dateOfBirth: '2000-01-01' }, { status: 'ACTIVE' }, { companyId: A }, { id: randomUUID() }]) {
        expect((await post(hr, '/employees', { ...ok, ...extra })).status, JSON.stringify(extra)).toBe(400);
      }
      expect((await post(hr, '/employees', { firstName: 'A', lastName: 'B' })).status).toBe(400);
      // each required field is individually required (EMP-001: work email, joining date, department, designation)
      for (const missing of ['workEmail', 'joiningDate', 'departmentId', 'designationId'] as const) {
        const rest = Object.fromEntries(Object.entries(ok).filter(([key]) => key !== missing));
        const res = await post(hr, '/employees', rest);
        expect(res.status, missing).toBe(400);
        expect(res.body.error.details.some((d: { path: string[] }) => d.path[0] === missing), missing).toBe(true);
      }
      expect((await post(hr, '/employees', { ...ok, employeeNumber: 'bad number!' })).status).toBe(400);
      expect((await post(hr, '/employees', { ...ok, workEmail: 'nope' })).status).toBe(400);
      expect((await post(hr, '/employees', { ...ok, hireDate: '01/02/2026' })).status).toBe(400);
      expect((await post(hr, '/employees', { ...ok, joiningDate: '01/02/2026' })).status).toBe(400);
    });

    it('accepts the contact fields the contract defines (phone, address, emergency contact) and returns them', async () => {
      const res = await post(hr, '/employees', { ...required(), employeeNumber: 'EMP-104', firstName: 'C', lastName: 'Contact', phone: '+91 90000 00000', address: '1 Main St', emergencyContact: 'Sam, 100' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ phone: '+91 90000 00000', address: '1 Main St', emergencyContact: 'Sam, 100' });
    });

    it('only employee:write may create (manager, employee: 403)', async () => {
      const body = { ...required(), employeeNumber: 'EMP-103', firstName: 'A', lastName: 'B' };
      expect((await post(mgr, '/employees', body)).status).toBe(403);
      expect((await post(emp, '/employees', body)).status).toBe(403);
    });
  });

  describe('update, department and manager assignment', () => {
    it('writes one audit entry per kind of change', async () => {
      const res = await patch(hr, `/employees/${s.peer.id}`, { jobTitle: 'Lead', departmentId: s.sales.id, managerId: s.mgr.id });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ jobTitle: 'Lead', department: { name: 'Sales' }, manager: { id: s.mgr.id } });
      const actions = fake.tables.employeeAuditLog.map((a) => a.action).sort();
      expect(actions).toEqual(['DEPARTMENT_CHANGED', 'MANAGER_CHANGED', 'UPDATED']);
      expect(fake.tables.employeeAuditLog.every((a) => a.companyId === A && a.actorUserId === 'user-hr')).toBe(true);
      const dept = fake.tables.employeeAuditLog.find((a) => a.action === 'DEPARTMENT_CHANGED');
      expect(dept?.changes).toEqual({ departmentId: { from: null, to: s.sales.id } });
    });

    it('a no-op patch writes nothing and audits nothing', async () => {
      const res = await patch(hr, `/employees/${s.r1.id}`, { firstName: 'Ravi', managerId: s.mgr.id });
      expect(res.status).toBe(200);
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
      expect(fake.calls.some((c) => c.model === 'Employee' && c.operation === 'update')).toBe(false);
    });

    it('can unassign a department and manager (null)', async () => {
      const res = await patch(hr, `/employees/${s.r1.id}`, { departmentId: null, managerId: null });
      expect(res.body.data).toMatchObject({ department: null, manager: null });
    });

    it('a terminated employee cannot be assigned as manager (create or edit); the others can', async () => {
      await put(hr, `/employees/${s.r2.id}/status`, { status: 'TERMINATED', terminationDate: '2026-06-30' });
      const create = await post(hr, '/employees', { ...required(), employeeNumber: 'EMP-120', firstName: 'N', lastName: 'Hire', managerId: s.r2.id });
      expect(create.status).toBe(400);
      expect(create.body.error.details[0].path).toEqual(['managerId']);
      expect((await patch(hr, `/employees/${s.peer.id}`, { managerId: s.r2.id })).status).toBe(400);
      expect((await patch(hr, `/employees/${s.peer.id}`, { managerId: s.mgr.id })).status).toBe(200);
    });

    it('rejects reporting cycles and self-management', async () => {
      // grand -> r1 -> mgr; making mgr report to grand would close the loop
      expect((await patch(hr, `/employees/${s.mgr.id}`, { managerId: s.grand.id })).status).toBe(400);
      expect((await patch(hr, `/employees/${s.mgr.id}`, { managerId: s.mgr.id })).status).toBe(400);
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
    });

    it('409 when renaming to an existing employee number; 400 on empty or unknown fields', async () => {
      expect((await patch(`t:u-sa:${A}`, `/employees/${s.peer.id}`, { employeeNumber: 'emp-001' })).status).toBe(409); // Super Admin only (W9)
      expect((await patch(hr, `/employees/${s.peer.id}`, {})).status).toBe(400);
      expect((await patch(hr, `/employees/${s.peer.id}`, { status: 'TERMINATED' })).status).toBe(400);
      expect((await patch(hr, `/employees/${s.peer.id}`, { companyId: B })).status).toBe(400);
    });

    it('employees (and managers) cannot edit anyone, including themselves', async () => {
      expect((await patch(emp, `/employees/${s.eve.id}`, { jobTitle: 'CEO' })).status).toBe(403);
      expect((await patch(mgr, `/employees/${s.r1.id}`, { jobTitle: 'x' })).status).toBe(403);
      expect(fake.tables.employee.find((e) => e.id === s.eve.id)?.jobTitle).toBeNull();
    });
  });

  describe('status changes', () => {
    it('terminates with a date, audits it, and reactivation clears the date', async () => {
      const t = await put(hr, `/employees/${s.r2.id}/status`, { status: 'TERMINATED', terminationDate: '2026-06-30' });
      expect(t.status).toBe(200);
      expect(t.body.data).toMatchObject({ status: 'TERMINATED', terminationDate: '2026-06-30' });
      const back = await put(hr, `/employees/${s.r2.id}/status`, { status: 'ACTIVE' });
      expect(back.body.data).toMatchObject({ status: 'ACTIVE', terminationDate: null });
      const audits = fake.tables.employeeAuditLog.filter((a) => a.action === 'STATUS_CHANGED');
      expect(audits).toHaveLength(2);
      expect(audits[0]?.changes).toEqual({
        status: { from: 'ONBOARDING', to: 'TERMINATED' },
        terminationDate: { from: null, to: '2026-06-30' },
      });
    });

    it('requires a termination date to terminate, and not before the hire date', async () => {
      expect((await put(hr, `/employees/${s.r1.id}/status`, { status: 'TERMINATED' })).status).toBe(400);
      expect((await put(hr, `/employees/${s.r1.id}/status`, { status: 'ACTIVE', terminationDate: '2026-01-01' })).status).toBe(400);
      expect((await put(hr, `/employees/${s.r1.id}/status`, { status: 'TERMINATED', terminationDate: '2019-12-31' })).status).toBe(400);
      expect((await put(hr, `/employees/${s.r1.id}/status`, { status: 'RETIRED' })).status).toBe(400);
    });

    it('is a no-op (no audit) when nothing changes', async () => {
      expect((await put(hr, `/employees/${s.r1.id}/status`, { status: 'ACTIVE' })).status).toBe(200);
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
    });

    it('needs employee:status:write (write alone, manager and employee get 403)', async () => {
      const body = { status: 'ON_LEAVE' };
      expect((await put(`t:u-hr-nostatus:${A}`, `/employees/${s.r1.id}/status`, body)).status).toBe(403);
      expect((await put(mgr, `/employees/${s.r1.id}/status`, body)).status).toBe(403);
      expect((await put(emp, `/employees/${s.eve.id}/status`, body)).status).toBe(403);
    });
  });

  describe('departments (read-only options)', () => {
    it("lists only the caller company's active departments by name", async () => {
      const res = await get(hr, '/departments');
      expect(res.body.data.map((d: { name: string }) => d.name)).toEqual(['Engineering', 'Sales']);
      expect(res.body.data.every((d: { id: string }) => d.id !== s.deptB.id)).toBe(true);
    });

    it('every role may view departments (PRD ORG-002); a caller with no org permission gets 403', async () => {
      expect((await get(emp, '/departments')).status).toBe(200);
      expect((await get(mgr, '/departments')).status).toBe(200);
    });
  });

  describe('privacy (PRD section 5): address and emergency contact are for HR, Super Admin and the owner', () => {
    it('hides them from a manager on read, list and timeline, and shows work and contact fields', async () => {
      const detail = await get(mgr, `/employees/${s.r2.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ address: null, emergencyContact: null, workEmail: 'sara.singh@company-a.test' });
      const list = await get(mgr, '/employees');
      expect(JSON.stringify(list.body)).not.toContain('Private');
      await patch(hr, `/employees/${s.r2.id}`, { address: '10 Secret Street', jobTitle: 'Analyst' });
      const timeline = await get(mgr, `/employees/${s.r2.id}/timeline`);
      expect(timeline.status).toBe(200);
      expect(JSON.stringify(timeline.body)).not.toMatch(/Secret|Private/);
      expect(JSON.stringify(timeline.body)).toContain('Analyst');
    });
    it('shows them to HR', async () => {
      const res = await get(hr, `/employees/${s.r2.id}`);
      expect(res.body.data).toMatchObject({ address: '9 Private Road', emergencyContact: 'Private Person' });
    });
    it('the directory gives every role name, title, department and work email only', async () => {
      const res = await get(emp, '/employees/directory?q=sara');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data[0]).sort()).toEqual(['departmentName', 'firstName', 'id', 'lastName', 'title', 'workEmail']);
      expect(JSON.stringify(res.body)).not.toContain('Private');
    });
    it('a self-update changes only the fields sent', async () => {
      fake.tables.employee.find((e) => e.id === s.eve.id)!.phone = '111';
      const res = await patch(emp, '/employees/me', { address: 'New address' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ phone: '111', address: 'New address' });
    });
  });

  describe('Super Admin only fields and concurrent edits (PRD W9)', () => {
    it('HR cannot change the employee ID or an existing joining date', async () => {
      expect((await patch(hr, `/employees/${s.peer.id}`, { employeeNumber: 'EMP-900' })).status).toBe(403);
      expect((await patch(hr, `/employees/${s.r2.id}`, { joiningDate: '2025-01-01' })).status).toBe(403);
      expect((await patch(hr, `/employees/${s.peer.id}`, { joiningDate: '2025-01-01' })).status).toBe(200); // filling an empty date
    });
    it('a stale expectedUpdatedAt is a 409 and writes nothing', async () => {
      const res = await patch(hr, `/employees/${s.peer.id}`, { jobTitle: 'X', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
      expect(res.status).toBe(409);
      expect(fake.tables.employeeAuditLog).toHaveLength(0);
    });
  });

  it('validates the :id parameter', async () => {
    expect((await get(hr, '/employees/not-a-uuid')).status).toBe(400);
    expect((await get(hr, `/employees/${randomUUID()}`)).status).toBe(404);
  });
});
