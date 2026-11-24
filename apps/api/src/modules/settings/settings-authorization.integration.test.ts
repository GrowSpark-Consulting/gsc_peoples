import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_DEFAULT_PERMISSIONS, ROLE_KEYS, type RoleKey } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from '../auth/password';

/**
 * Settings / user-account authorization policy (PRD AUTH-004, AUTH-005, AUTH-006, SET-001, SET-002,
 * SET-004, W4) against REAL PostgreSQL (`hr_test` only) with real password login, session cookies and
 * CSRF. Nothing is mocked. The app is pointed at hr_test BEFORE its modules load.
 *
 *  - Super Admin: everything.
 *  - HR Admin: list accounts; invite, resend and activate/deactivate for Manager/Employee only. Never
 *    anything on an HR Admin or Super Admin account, role changes, company settings or the audit log.
 *  - Manager / Employee: nothing under /settings.
 */

const PASSWORD = 'correct-horse-battery';
const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();

let admin: pg.Client;
let app: Express;
let disconnect: () => Promise<void>;

const id = () => randomUUID();
const roleIds: Record<string, Record<RoleKey, string>> = {};

type Persona = 'sa' | 'hr' | 'mgr' | 'emp';
const EMAIL: Record<Persona, string> = {
  sa: 'sa@example.com',
  hr: 'hr@example.com',
  mgr: 'mgr@example.com',
  emp: 'emp@example.com',
};
const ROLE_OF: Record<Persona, RoleKey> = { sa: 'SUPER_ADMIN', hr: 'HR_ADMIN', mgr: 'MANAGER', emp: 'EMPLOYEE' };

async function seedUser(email: string, companyId: string, roleKey: RoleKey, opts: { password?: boolean; status?: string } = {}) {
  const userId = id();
  await admin.query(
    `INSERT INTO hr.users (id,"externalId",email,name,"passwordHash",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`,
    [userId, userId, email, email.split('@')[0], opts.password === false ? null : hashPassword(PASSWORD)],
  );
  const membershipId = id();
  await admin.query(
    `INSERT INTO hr.company_memberships (id,"companyId","userId","roleId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())`,
    [membershipId, companyId, userId, roleIds[companyId]![roleKey], opts.status ?? 'ACTIVE'],
  );
  return { userId, membershipId };
}

type Session = { cookie: string; csrf: string };
async function login(persona: Persona): Promise<Session> {
  const res = await request(app).post('/api/v1/auth/login').send({ email: EMAIL[persona], password: PASSWORD });
  expect(res.status, `login ${persona}`).toBe(200);
  const jar = Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  );
  return {
    cookie: `gsc_session=${encodeURIComponent(jar.gsc_session!)}; gsc_csrf=${encodeURIComponent(jar.gsc_csrf!)}`,
    csrf: jar.gsc_csrf!,
  };
}
const get = (s: Session, url: string) => request(app).get(`/api/v1${url}`).set('Cookie', s.cookie);
const send = (method: 'post' | 'patch', s: Session, url: string, body: object = {}) =>
  request(app)[method](`/api/v1${url}`).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).send(body);

const auditActions = async (companyId = COMPANY_A) =>
  (await admin.query(`SELECT action FROM hr.audit_logs WHERE "companyId"=$1 ORDER BY "createdAt"`, [companyId])).rows.map((r) => r.action as string);

beforeAll(async () => {
  const testAppUrl = testUrl('TEST_DATABASE_URL'); // validated: must be hr_test
  admin = await connect('TEST_DIRECT_URL');
  process.env.DATABASE_URL = testAppUrl;
  const { createApp } = await import('../../app');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  const rows = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  expect(rows[0]?.db).toBe(TEST_DB); // the scratch database, never hr_db/hr_test
  app = createApp();
});

afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

let seeded: Record<Persona, { userId: string; membershipId: string }>;
let otherCompanyMembership: string;

beforeEach(async () => {
  await resetData(admin);
  for (const c of [COMPANY_A, COMPANY_B]) {
    await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,$1,now())`, [c]);
    roleIds[c] = {} as Record<RoleKey, string>;
    for (const key of ROLE_KEYS) {
      const roleId = id();
      roleIds[c]![key] = roleId;
      await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [roleId, c, key]);
      for (const p of ROLE_DEFAULT_PERMISSIONS[key] ?? []) {
        await admin.query(`INSERT INTO hr.role_permissions (id,"companyId","roleId",permission) VALUES ($1,$2,$3,$4)`, [id(), c, roleId, p]);
      }
    }
  }
  seeded = {} as typeof seeded;
  for (const p of Object.keys(EMAIL) as Persona[]) seeded[p] = await seedUser(EMAIL[p], COMPANY_A, ROLE_OF[p]);
  otherCompanyMembership = (await seedUser('other.emp@example.com', COMPANY_B, 'EMPLOYEE')).membershipId;
});

describe('Manager and Employee: nothing under /settings', () => {
  for (const persona of ['mgr', 'emp'] as const) {
    it(`${persona} is refused (403) on every settings route and nothing changes`, async () => {
      const s = await login(persona);
      const target = seeded.emp.membershipId;
      expect((await get(s, '/settings/users')).status).toBe(403);
      expect((await get(s, '/settings/company')).status).toBe(403);
      expect((await get(s, '/settings/audit-logs')).status).toBe(403);
      expect((await send('post', s, '/settings/users/invite', { email: 'x@example.com', roleKey: 'EMPLOYEE' })).status).toBe(403);
      expect((await send('post', s, `/settings/users/${target}/invitations/resend`)).status).toBe(403);
      expect((await send('patch', s, `/settings/users/${target}/status`, { status: 'DISABLED' })).status).toBe(403);
      expect((await send('patch', s, `/settings/users/${target}/role`, { roleKey: 'HR_ADMIN' })).status).toBe(403);
      expect(await auditActions()).toEqual([]);
      const { rows } = await admin.query(`SELECT count(*)::int n FROM hr.users WHERE email = 'x@example.com'`);
      expect(rows[0].n).toBe(0);
    });
  }
});

describe('HR Admin: the ordinary-user workflow (AUTH-004, AUTH-006, SET-002)', () => {
  it('lists the company accounts, scoped to its own company', async () => {
    const hr = await login('hr');
    const res = await get(hr, '/settings/users');
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email).sort();
    expect(emails).toEqual(Object.values(EMAIL).sort());
    expect(emails).not.toContain('other.emp@example.com'); // company B never appears
  });

  it('invites Employee and Manager logins (audited, company-scoped), and the invitee can activate', async () => {
    const hr = await login('hr');
    for (const roleKey of ['EMPLOYEE', 'MANAGER']) {
      const res = await send('post', hr, '/settings/users/invite', { email: `new.${roleKey.toLowerCase()}@example.com`, roleKey });
      expect(res.status, roleKey).toBe(201);
      const { rows } = await admin.query(
        `SELECT m."companyId", m.status, r.key FROM hr.company_memberships m JOIN hr.roles r ON r.id = m."roleId" WHERE m.id = $1`,
        [res.body.data.membershipId],
      );
      expect(rows[0]).toMatchObject({ companyId: COMPANY_A, status: 'INVITED', key: roleKey });
      const accept = await request(app).post('/api/v1/auth/accept-invitation').send({ token: res.body.data.invitationToken, password: 'a-long-enough-pass' });
      expect(accept.status).toBe(200);
    }
    expect(await auditActions()).toEqual(['INVITED', 'INVITED']);
    const actor = await admin.query(`SELECT DISTINCT "actorId" FROM hr.audit_logs WHERE "companyId"=$1`, [COMPANY_A]);
    expect(actor.rows).toEqual([{ actorId: seeded.hr.userId }]);
  });

  it('cannot invite HR Admin or Super Admin logins (only a Super Admin can) and creates nothing', async () => {
    const hr = await login('hr');
    for (const roleKey of ['HR_ADMIN', 'SUPER_ADMIN']) {
      const res = await send('post', hr, '/settings/users/invite', { email: `escalate.${roleKey}@example.com`, roleKey });
      expect(res.status, roleKey).toBe(403);
    }
    const { rows } = await admin.query(`SELECT count(*)::int n FROM hr.users WHERE email LIKE 'escalate.%'`);
    expect(rows[0].n).toBe(0);
    expect(await auditActions()).toEqual([]);
  });

  it('resends an Employee invitation (old link revoked, new link works) but not an HR Admin one', async () => {
    const hr = await login('hr');
    const sa = await login('sa');
    const first = await send('post', hr, '/settings/users/invite', { email: 'resend@example.com', roleKey: 'EMPLOYEE' });
    const resent = await send('post', hr, `/settings/users/${first.body.data.membershipId}/invitations/resend`);
    expect(resent.status).toBe(200);
    expect(resent.body.data.invitationToken).not.toBe(first.body.data.invitationToken);
    expect((await request(app).post('/api/v1/auth/accept-invitation').send({ token: first.body.data.invitationToken, password: 'a-long-enough-pass' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/accept-invitation').send({ token: resent.body.data.invitationToken, password: 'a-long-enough-pass' })).status).toBe(200);
    expect(await auditActions()).toContain('INVITATION_RESENT');

    // An HR Admin invitation created by the Super Admin is off limits to HR.
    const hrInvite = await send('post', sa, '/settings/users/invite', { email: 'newhr@example.com', roleKey: 'HR_ADMIN' });
    expect(hrInvite.status).toBe(201);
    expect((await send('post', hr, `/settings/users/${hrInvite.body.data.membershipId}/invitations/resend`)).status).toBe(403);
  });

  it('deactivates and reactivates an ordinary user: sessions die, login is blocked, all audited', async () => {
    const hr = await login('hr');
    const emp = await login('emp');
    expect((await get(emp, '/me')).status).toBe(200);

    const off = await send('patch', hr, `/settings/users/${seeded.emp.membershipId}/status`, { status: 'DISABLED' });
    expect(off.status).toBe(200);
    expect((await get(emp, '/me')).status).toBe(401); // live session rejected on the next request
    expect((await request(app).post('/api/v1/auth/login').send({ email: EMAIL.emp, password: PASSWORD })).status).toBe(401);

    const on = await send('patch', hr, `/settings/users/${seeded.emp.membershipId}/status`, { status: 'ACTIVE' });
    expect(on.status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ email: EMAIL.emp, password: PASSWORD })).status).toBe(200);
    expect(await auditActions()).toEqual(['DISABLED', 'ACTIVATED']);
  });
});

describe('HR Admin: the limits', () => {
  it('cannot deactivate, reactivate or otherwise touch a Super Admin account', async () => {
    const hr = await login('hr');
    const sa = await login('sa');
    expect((await send('patch', hr, `/settings/users/${seeded.sa.membershipId}/status`, { status: 'DISABLED' })).status).toBe(403);
    expect((await get(sa, '/me')).status).toBe(200); // the Super Admin is untouched and still signed in
    const { rows } = await admin.query(`SELECT u.status AS user_status, m.status AS membership_status FROM hr.users u JOIN hr.company_memberships m ON m."userId"=u.id WHERE m.id=$1`, [seeded.sa.membershipId]);
    expect(rows[0]).toEqual({ user_status: 'ACTIVE', membership_status: 'ACTIVE' });
    expect(await auditActions()).toEqual([]);
  });

  it('cannot deactivate another HR Admin or itself: only a Super Admin can, and nothing changes or is audited', async () => {
    const otherHr = await seedUser('hr2@example.com', COMPANY_A, 'HR_ADMIN');
    const hr = await login('hr');
    const otherSession = await login('hr'); // a live session of the acting HR, to prove it survives
    for (const target of [otherHr.membershipId, seeded.hr.membershipId]) {
      expect((await send('patch', hr, `/settings/users/${target}/status`, { status: 'DISABLED' })).status).toBe(403);
    }
    const { rows } = await admin.query(
      `SELECT u.status AS user_status, m.status AS membership_status FROM hr.users u JOIN hr.company_memberships m ON m."userId"=u.id WHERE m.id = ANY($1)`,
      [[otherHr.membershipId, seeded.hr.membershipId]],
    );
    expect(rows).toEqual([
      { user_status: 'ACTIVE', membership_status: 'ACTIVE' },
      { user_status: 'ACTIVE', membership_status: 'ACTIVE' },
    ]);
    expect((await get(otherSession, '/me')).status).toBe(200);
    expect(await auditActions()).toEqual([]);
  });

  it('cannot resend a pending Super Admin invitation, or invite a Super Admin or HR Admin even with a role string in another case or shape', async () => {
    const sa = await login('sa');
    const hr = await login('hr');
    const pendingSa = await send('post', sa, '/settings/users/invite', { email: 'newsa@example.com', roleKey: 'SUPER_ADMIN' });
    expect(pendingSa.status).toBe(201);
    const before = await auditActions();
    expect((await send('post', hr, `/settings/users/${pendingSa.body.data.membershipId}/invitations/resend`)).status).toBe(403);
    for (const roleKey of ['super_admin', 'SUPER_ADMIN ', ['SUPER_ADMIN'], { key: 'SUPER_ADMIN' }]) {
      const res = await send('post', hr, '/settings/users/invite', { email: 'sneaky@example.com', roleKey });
      expect(res.status, JSON.stringify(roleKey)).toBe(400); // schema rejects anything but the exact enum
    }
    expect((await admin.query(`SELECT count(*)::int n FROM hr.users WHERE email = 'sneaky@example.com'`)).rows[0].n).toBe(0);
    expect(await auditActions()).toEqual(before); // refused attempts add no audit rows
  });

  it("cannot reach another company's HR Admin or Super Admin: not found, unchanged", async () => {
    const foreignHr = await seedUser('foreign.hr@example.com', COMPANY_B, 'HR_ADMIN');
    const foreignSa = await seedUser('foreign.sa@example.com', COMPANY_B, 'SUPER_ADMIN');
    const hr = await login('hr');
    for (const target of [foreignHr.membershipId, foreignSa.membershipId]) {
      expect((await send('patch', hr, `/settings/users/${target}/status`, { status: 'DISABLED' })).status).toBe(409);
      expect((await send('post', hr, `/settings/users/${target}/invitations/resend`)).status).toBe(409);
      expect((await send('patch', hr, `/settings/users/${target}/role`, { roleKey: 'EMPLOYEE' })).status).toBe(403);
    }
    const { rows } = await admin.query(`SELECT status FROM hr.company_memberships WHERE id = ANY($1)`, [[foreignHr.membershipId, foreignSa.membershipId]]);
    expect(rows).toEqual([{ status: 'ACTIVE' }, { status: 'ACTIVE' }]);
    expect(await auditActions(COMPANY_B)).toEqual([]);
  });

  it('cannot change roles, read or change company settings, or read the audit log', async () => {
    const hr = await login('hr');
    expect((await send('patch', hr, `/settings/users/${seeded.emp.membershipId}/role`, { roleKey: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await send('patch', hr, `/settings/users/${seeded.hr.membershipId}/role`, { roleKey: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await get(hr, '/settings/company')).status).toBe(403);
    expect((await send('patch', hr, '/settings/company', { name: 'Hacked' })).status).toBe(403);
    expect((await get(hr, '/settings/audit-logs')).status).toBe(403);
    const { rows } = await admin.query(`SELECT r.key FROM hr.company_memberships m JOIN hr.roles r ON r.id = m."roleId" WHERE m.id = $1`, [seeded.emp.membershipId]);
    expect(rows[0].key).toBe('EMPLOYEE');
  });

  it("cannot reach another company's accounts: a foreign membership id is not found and unchanged", async () => {
    const hr = await login('hr');
    const res = await send('patch', hr, `/settings/users/${otherCompanyMembership}/status`, { status: 'DISABLED' });
    expect(res.status).toBe(409); // existing contract: 'Membership not found' (never reveals or touches it)
    const { rows } = await admin.query(`SELECT status FROM hr.company_memberships WHERE id=$1`, [otherCompanyMembership]);
    expect(rows[0].status).toBe('ACTIVE');
    expect((await send('post', hr, `/settings/users/${otherCompanyMembership}/invitations/resend`)).status).toBe(409);
  });

  it('writes still need a valid CSRF token', async () => {
    const hr = await login('hr');
    const res = await request(app).post('/api/v1/settings/users/invite').set('Cookie', hr.cookie).send({ email: 'nocsrf@example.com', roleKey: 'EMPLOYEE' });
    expect(res.status).toBe(403);
  });
});

describe('Super Admin keeps full control', () => {
  it('invites HR Admin, changes roles, reads company settings and the audit log', async () => {
    const sa = await login('sa');
    expect((await send('post', sa, '/settings/users/invite', { email: 'hr2@example.com', roleKey: 'HR_ADMIN' })).status).toBe(201);
    expect((await send('patch', sa, `/settings/users/${seeded.emp.membershipId}/role`, { roleKey: 'MANAGER' })).status).toBe(200);
    expect((await get(sa, '/settings/company')).status).toBe(200);
    const logs = await get(sa, '/settings/audit-logs');
    expect(logs.status).toBe(200);
    expect((logs.body.data as { action: string }[]).map((l) => l.action).sort()).toEqual(['INVITED', 'ROLE_CHANGED']);
  });

  it('deactivates and reactivates an HR Admin (audited), which HR itself may not do', async () => {
    const sa = await login('sa');
    const hr = await login('hr'); // the target's live session must die when it is deactivated
    expect((await send('patch', sa, `/settings/users/${seeded.hr.membershipId}/status`, { status: 'DISABLED' })).status).toBe(200);
    expect((await get(hr, '/me')).status).toBe(401);
    expect((await send('patch', sa, `/settings/users/${seeded.hr.membershipId}/status`, { status: 'ACTIVE' })).status).toBe(200);
    expect(await auditActions()).toEqual(['DISABLED', 'ACTIVATED']);
  });

  it('the last Super Admin still cannot be disabled', async () => {
    const sa = await login('sa');
    const res = await send('patch', sa, `/settings/users/${seeded.sa.membershipId}/status`, { status: 'DISABLED' });
    expect(res.status).toBe(403);
  });
});
