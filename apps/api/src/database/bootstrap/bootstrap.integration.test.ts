import type pg from 'pg';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meResponseSchema } from '@gsc/contracts';
import { secureToken, tokenHash } from '../../modules/auth/password';
import { bindTenant, connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { assertMigrated, bootstrapCompany, bootstrapConfigSchema, type BootstrapConfig } from './bootstrap';

/** PRD W1 against real PostgreSQL (scratch database): bootstrap, repeat, dry run, refusal, then real use. */
const PASSWORD = 'first-admin-password';
const config: BootstrapConfig = bootstrapConfigSchema.parse({
  company: { name: 'Bootstrap Co', timezone: 'Asia/Kolkata' },
  superAdmin: { firstName: 'Sam', lastName: 'Admin', workEmail: 'Sam.Admin@Example.com', department: 'People', designation: 'Founder' },
  departments: ['People', 'Engineering'],
  designations: ['Founder', 'Engineer'],
  leaveTypes: [
    { name: 'Casual', annualAllocation: 12, isPaid: true, allowHalfDay: true },
    { name: 'Sick', annualAllocation: 8, isPaid: true, allowHalfDay: true },
    { name: 'Earned', annualAllocation: 15, isPaid: true, allowHalfDay: false },
  ],
  onboardingTasks: [
    { title: 'Collect ID proof', dueOffsetDays: 0, assigneeType: 'EMPLOYEE' },
    { title: 'Create accounts', dueOffsetDays: 1, assigneeType: 'HR' },
  ],
});

let admin: pg.Client;
let app: Express;
let disconnect: () => Promise<void>;

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testUrl('TEST_DATABASE_URL');
  const { createApp } = await import('../../app');
  const { getPrisma, disconnectDatabase } = await import('../client');
  disconnect = disconnectDatabase;
  const db = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(db[0]?.db).toBe(TEST_DB);
  app = createApp() as Express;
});
afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});
beforeEach(() => resetData(admin));

const count = async (table: string) => Number((await admin.query(`select count(*)::int n from hr.${table}`)).rows[0].n);
const link = () => {
  const token = secureToken();
  return { token, invitation: { tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } };
};
const run = (dryRun = false, overrides: Partial<BootstrapConfig> = {}, invitation = link().invitation) =>
  bootstrapCompany(admin, { config: { ...config, ...overrides }, invitation, dryRun, now: new Date('2026-11-25T06:00:00Z') });
const activate = (token: string) => request(app).post('/api/v1/auth/accept-invitation').send({ token, password: PASSWORD });
const signIn = () => request(app).post('/api/v1/auth/login').send({ email: 'sam.admin@example.com', password: PASSWORD });
/** Bootstrap and activate through the real API, as the first Super Admin would. */
async function setUp() {
  const l = link();
  const report = await run(false, {}, l.invitation);
  expect((await activate(l.token)).status).toBe(200);
  return report;
}

describe('production bootstrap (PRD W1)', () => {
  it('a dry run reports the work and writes nothing', async () => {
    const report = await run(true);
    expect(report.created).toMatchObject({ company: 1, roles: 4, leaveTypes: 3, employees: 1, users: 1 });
    for (const table of ['companies', 'users', 'employees', 'leave_types', 'audit_logs']) expect(await count(table), table).toBe(0);
  });

  it('creates the company, four roles, the Super Admin, leave types, balances and the checklist, once', async () => {
    const first = await run();
    expect(first.created).toEqual({ company: 1, roles: 4, departments: 2, designations: 2, employees: 1, users: 1, memberships: 1, leaveTypes: 3, leaveBalances: 3, onboardingTasks: 2 });
    const [emp] = (await admin.query(`select "employeeNumber", status, to_char("joiningDate",'YYYY-MM-DD') d from hr.employees`)).rows;
    expect(emp).toEqual({ employeeNumber: 'EMP-0001', status: 'ACTIVE', d: '2026-11-25' });
    expect((await admin.query(`select year, allocated from hr.leave_balances order by allocated`)).rows).toEqual([
      { year: 2026, allocated: 8 }, { year: 2026, allocated: 12 }, { year: 2026, allocated: 15 },
    ]);
    expect(await count('audit_logs')).toBe(1);

    const second = await run();
    expect(Object.values(second.created).every((n) => n === 0)).toBe(true);
    expect(second.companyId).toBe(first.companyId);
    expect(await count('audit_logs')).toBe(1);
  });

  it('never sets a password: the account waits for activation and cannot sign in before it', async () => {
    const l = link();
    const report = await run(false, {}, l.invitation);
    expect(report.awaitingActivation).toBe(true);
    expect((await admin.query('select "passwordHash" h from hr.users')).rows).toEqual([{ h: null }]);
    expect((await signIn()).status).toBe(401);
    expect((await admin.query('select "tokenHash" t from hr.invitation_tokens')).rows).toEqual([{ t: l.invitation.tokenHash }]); // never the token
    expect((await activate(l.token)).status).toBe(200);
    expect((await signIn()).status).toBe(200);
    expect((await activate(l.token)).status).toBe(401); // single use
  });

  it('a new link before activation voids the earlier one; afterwards nothing is reissued', async () => {
    const first = link();
    const second = link();
    await run(false, {}, first.invitation);
    await run(false, {}, second.invitation);
    expect((await activate(first.token)).status).toBe(401);
    expect((await activate(second.token)).status).toBe(200);
    const third = link();
    const again = await run(false, {}, third.invitation);
    expect(again.awaitingActivation).toBe(false);
    expect((await activate(third.token)).status).toBe(401);
    expect((await signIn()).status).toBe(200);
  });

  it('never overwrites later edits', async () => {
    await run();
    await admin.query(`update hr.leave_types set "annualAllocation" = 20 where name = 'Casual'`);
    await run();
    expect((await admin.query(`select "annualAllocation" a from hr.leave_types where name='Casual'`)).rows[0].a).toBe(20);
  });

  it('refuses a second company', async () => {
    await run();
    await expect(run(false, { company: { ...config.company, name: 'Another Co' } })).rejects.toThrow(/different company/);
    expect(await count('companies')).toBe(1);
  });

  it('rejects an incomplete configuration', () => {
    const bad = (change: object) => bootstrapConfigSchema.safeParse({ ...config, ...change }).success;
    expect(bad({ company: { name: 'x' } })).toBe(false); // timezone is required
    expect(bad({ company: { ...config.company, timezone: 'Mars/Base' } })).toBe(false);
    expect(bad({ company: { ...config.company, workingDays: [] } })).toBe(false);
    expect(bad({ leaveTypes: [config.leaveTypes[0]] })).toBe(false); // Casual, Sick and Earned are required
    expect(bad({ superAdmin: { ...config.superAdmin, department: 'Nowhere' } })).toBe(false);
  });

  it('the created Super Admin signs in, loads /me and creates the next employee through the API', async () => {
    const { companyId } = await setUp();
    const login = await signIn();
    expect(login.status).toBe(200);
    const cookies = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!);
    const csrf = decodeURIComponent(cookies.find((c) => c.startsWith('gsc_csrf='))!.slice('gsc_csrf='.length));
    const me = meResponseSchema.parse((await request(app).get('/api/v1/me').set('cookie', cookies.join('; '))).body).data;
    expect(me).toMatchObject({ role: 'SUPER_ADMIN', companyId, company: { name: 'Bootstrap Co', timezone: 'Asia/Kolkata' } });
    const ids = (await admin.query(`select (select id from hr.departments where name='Engineering') d, (select id from hr.designations where name='Engineer') g`)).rows[0];
    const created = await request(app).post('/api/v1/employees').set('cookie', cookies.join('; ')).set('x-csrf-token', csrf)
      .send({ firstName: 'Nina', lastName: 'New', workEmail: 'nina@example.com', joiningDate: '2026-11-25', departmentId: ids.d, designationId: ids.g });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.employeeNumber).toBe('EMP-0002');
    expect(await count('onboarding_tasks')).toBe(2); // ONB-001: copied from the template
  });

  it('the runtime role sees the new company only with its context (RLS)', async () => {
    const { companyId } = await run();
    const runtime = await connect('TEST_DATABASE_URL');
    try {
      expect((await runtime.query('select count(*)::int n from hr.employees')).rows[0].n).toBe(0);
      await bindTenant(runtime, companyId);
      expect((await runtime.query('select count(*)::int n from hr.employees')).rows[0].n).toBe(1);
    } finally {
      await runtime.end();
    }
  });

  it('refuses a database whose migrations are not all recorded', async () => {
    await expect(assertMigrated(admin, ['99999999999999_future'])).rejects.toThrow(/migration/i);
    await expect(assertMigrated(admin)).resolves.toBeUndefined();
  });
});
