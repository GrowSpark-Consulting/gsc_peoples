import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, meResponseSchema, permissionsForRole } from '@gsc/contracts';
import { createApp } from '../../app';
import { DevAuthProvider } from '../../integrations/central-auth/dev.provider';
import { connect, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { createPrismaClient } from '../client';
import type { PrismaClient } from '../generated/client';
import { createIdentityStore } from '../identity';
import { assertLocalTarget, defaultSpec, provisionLocal } from './local-provisioning';

/** Real PostgreSQL (hr_test): provisioning as hr_migrator, then the real app as hr_app. */
const COMPANY = 'prov-co';
let admin: pg.Client;
let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

const appFor = (companyId: string) =>
  createApp({
    authProvider: new DevAuthProvider(companyId),
    resolveMembership: (i) => createIdentityStore(prisma).resolveActiveMembership(i),
  });

const counts = async () => {
  const q = async (t: string) =>
    Number((await admin.query(`SELECT count(*)::int AS n FROM hr.${t}`)).rows[0].n);
  return {
    companies: await q('companies'),
    roles: await q('roles'),
    perms: await q('role_permissions'),
    depts: await q('departments'),
    users: await q('users'),
    employees: await q('employees'),
    memberships: await q('company_memberships'),
  };
};

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  prisma = createPrismaClient(testUrl('TEST_DATABASE_URL'));
  await resetData(admin);
  app = appFor(COMPANY);
});

afterAll(async () => {
  await prisma.$disconnect();
  await admin.end();
});

describe('local provisioning', () => {
  it('creates everything, and a second run creates nothing', async () => {
    const first = await provisionLocal(admin, defaultSpec(COMPANY));
    expect(first.created).toMatchObject({
      company: 1,
      roles: 4,
      departments: 2,
      users: 4,
      employees: 4,
      memberships: 4,
    });
    const after1 = await counts();
    const second = await provisionLocal(admin, defaultSpec(COMPANY));
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true);
    expect(await counts()).toEqual(after1);
    expect(second.extraPermissions).toEqual({});
  });

  it('links memberships to employees and sets reporting lines', async () => {
    const { rows } = await admin.query(
      `SELECT e."employeeNumber" AS n, m."employeeId" = e.id AS linked, mgr."employeeNumber" AS mgr
       FROM hr.company_memberships m JOIN hr.employees e ON e.id = m."employeeId"
       LEFT JOIN hr.employees mgr ON mgr.id = e."managerId" ORDER BY 1`,
    );
    expect(rows).toEqual([
      { n: 'EMP-001', linked: true, mgr: null },
      { n: 'EMP-002', linked: true, mgr: null },
      { n: 'EMP-003', linked: true, mgr: 'EMP-002' },
      { n: 'EMP-004', linked: true, mgr: null },
    ]);
  });

  it('does not overwrite later edits on re-run', async () => {
    await admin.query(
      `UPDATE hr.employees SET "jobTitle" = 'Edited' WHERE "employeeNumber" = 'EMP-003'`,
    );
    await provisionLocal(admin, defaultSpec(COMPANY));
    const { rows } = await admin.query(
      `SELECT "jobTitle" FROM hr.employees WHERE "employeeNumber" = 'EMP-003'`,
    );
    expect(rows[0].jobTitle).toBe('Edited');
  });

  it('GET /me returns the real membership permissions per persona', async () => {
    const me = async (u: string) =>
      meResponseSchema.parse(
        (await request(app).get('/api/v1/me').set('authorization', `Bearer dev:${u}`)).body,
      ).data;
    expect((await me('dev-hr-admin')).permissions).toContain(PERMISSIONS.EMPLOYEE_WRITE);
    const mgr = await me('dev-manager');
    expect(mgr.roles).toEqual(['MANAGER']);
    expect(mgr.permissions).not.toContain(PERMISSIONS.EMPLOYEE_WRITE);
    const emp = (await me('dev-employee')).permissions;
    expect([...emp].sort()).toEqual([...permissionsForRole('EMPLOYEE')].sort()); // code-defined matrix (PRD SET-003)
    expect(emp).not.toContain(PERMISSIONS.EMPLOYEE_WRITE);
  });

  it('unknown dev identities get 401 and other-company tokens get 403', async () => {
    const auth = (u: string) => `Bearer dev:${u}`;
    expect((await request(app).get('/api/v1/me').set('authorization', auth('nobody'))).status).toBe(401);
    const other = appFor('other-co');
    expect(
      (await request(other).get('/api/v1/me').set('authorization', auth('dev-hr-admin'))).status,
    ).toBe(403);
  });

  it('refuses non-local targets and unknown databases', () => {
    expect(() => assertLocalTarget('postgresql://u:p@db.prod.example.com:5432/hr_db')).toThrow(/localhost/);
    expect(() => assertLocalTarget('postgresql://u:p@localhost:5432/other')).toThrow(/database/);
    expect(assertLocalTarget('postgresql://u:p@localhost:5432/hr_db?schema=hr').database).toBe('hr_db');
  });
});
