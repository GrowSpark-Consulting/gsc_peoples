import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_DEFAULT_PERMISSIONS } from '@gsc/contracts';
import { connect, TEST_DB, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from './password';

/**
 * End-to-end password login + session cookie + CSRF + tenant resolution against REAL PostgreSQL
 * (`hr_test` only). The app is built with its real Prisma client, pointed at hr_test BEFORE the app
 * modules load (the app otherwise reads DATABASE_URL, which is the development database).
 *
 * This verifies the SESSION path. The development bearer-token path is a separate claim; the
 * "two paths" block below only checks how they interact.
 */

const PASSWORD = 'correct-horse-battery';
const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const DEPT_A = randomUUID(); // department of company A for the create-employee contract (PRD EMP-001)
const DESIGNATION_A = randomUUID();
const COMPANY_DEV = 'dev-company'; // intentionally NOT a UUID, like the provisioned dev company

let admin: pg.Client;
let app: Express;
let appDb: pg.Client; // hr_app, the same role the API runs as
let disconnect: () => Promise<void>;

const id = () => randomUUID();
const cookiesOf = (res: request.Response): Record<string, string> =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  );
const rawSetCookie = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`)) ?? '';
const cookieHeader = (c: Record<string, string>) =>
  `gsc_session=${encodeURIComponent(c.gsc_session!)}; gsc_csrf=${encodeURIComponent(c.gsc_csrf!)}`;

async function login(body: Record<string, unknown>) {
  const res = await request(app).post('/api/v1/auth/login').send(body);
  return { res, cookies: cookiesOf(res) };
}
const sessionRows = async (email?: string) =>
  (
    await admin.query(
      `SELECT s.* FROM hr.user_sessions s JOIN hr.users u ON u.id = s."userId" ${email ? 'WHERE u.email = $1' : ''} ORDER BY s."createdAt"`,
      email ? [email] : [],
    )
  ).rows;

async function seedUser(opts: {
  email: string;
  externalId?: string;
  password?: string | null;
  status?: 'ACTIVE' | 'DISABLED';
  memberships: { companyId: string; membershipStatus?: string }[];
}) {
  const userId = id();
  await admin.query(
    `INSERT INTO hr.users (id, "externalId", email, name, "passwordHash", status, "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [
      userId,
      opts.externalId ?? userId,
      opts.email,
      opts.email.split('@')[0],
      opts.password === null ? null : hashPassword(opts.password ?? PASSWORD),
      opts.status ?? 'ACTIVE',
    ],
  );
  for (const m of opts.memberships) {
    const { rows } = await admin.query(`SELECT id FROM hr.roles WHERE "companyId"=$1 AND key='HR_ADMIN'`, [m.companyId]);
    const employeeId = id();
    await admin.query(
      `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","updatedAt") VALUES ($1,$2,$3,'F','L',now())`,
      [employeeId, m.companyId, `N-${employeeId.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO hr.company_memberships (id,"companyId","userId","roleId","employeeId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [id(), m.companyId, userId, rows[0].id, employeeId, m.membershipStatus ?? 'ACTIVE'],
    );
  }
  return userId;
}

beforeAll(async () => {
  // The guarded helpers must run first (they refuse a shared DATABASE_URL); then point the app at
  // hr_test BEFORE any app module is imported.
  const testAppUrl = testUrl('TEST_DATABASE_URL'); // validated: must be hr_test
  admin = await connect('TEST_DIRECT_URL');
  appDb = await connect('TEST_DATABASE_URL');
  process.env.DATABASE_URL = testAppUrl;
  const { createApp } = await import('../../app');
  const { DevAuthProvider } = await import('../../integrations/central-auth/dev.provider');
  const { getPrisma, disconnectDatabase } = await import('../../database/client');
  disconnect = disconnectDatabase;
  // Prove the app's own client is on hr_test (never hr_db).
  const rowsDb = (await getPrisma().$queryRawUnsafe('select current_database() as db')) as { db: string }[];
  const db = rowsDb[0]?.db;
  expect(db).toBe(TEST_DB); // the scratch database, never hr_db/hr_test
  // The bearer provider is the real DevAuthProvider, fixed to company A (as the API does in dev).
  app = createApp({ authProvider: new DevAuthProvider(COMPANY_A) });
});

afterAll(async () => {
  await disconnect?.();
  await appDb?.end();
  await admin?.end();
});

beforeEach(async () => {
  await resetData(admin);
  for (const c of [COMPANY_A, COMPANY_B, COMPANY_DEV]) {
    await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,$1,now())`, [c]);
    await admin.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now())`, [c === COMPANY_A ? DEPT_A : id(), c]);
    const roleId = id();
    await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,'HR_ADMIN','HR Admin',true,now())`, [roleId, c]);
    for (const p of ROLE_DEFAULT_PERMISSIONS.HR_ADMIN) {
      await admin.query(`INSERT INTO hr.role_permissions (id,"companyId","roleId",permission) VALUES ($1,$2,$3,$4)`, [id(), c, roleId, p]);
    }
  }
});

describe('login', () => {
  it('valid login (single membership, no companyId): sets hardened cookies and persists a hashed session', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { res, cookies } = await login({ email: 'HR@Example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ companyId: COMPANY_A, roleKey: 'HR_ADMIN' });
    expect(rawSetCookie(res, 'gsc_session')).toMatch(/HttpOnly/i);
    expect(rawSetCookie(res, 'gsc_session')).toMatch(/SameSite=Lax/i);
    expect(rawSetCookie(res, 'gsc_csrf')).not.toMatch(/HttpOnly/i); // the browser must read it to echo it
    const rows = await sessionRows('hr@example.com');
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toContain(cookies.gsc_session); // only a hash is stored
    expect(rows[0].csrfHash).not.toContain(cookies.gsc_csrf);
    expect(rows[0].companyId).toBe(COMPANY_A);
    const ttl = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
    expect(ttl).toBeGreaterThan(7.9 * 3600_000);
    expect(ttl).toBeLessThan(8.1 * 3600_000);
    const { rows: u } = await admin.query(`SELECT "lastLoginAt" FROM hr.users WHERE email='hr@example.com'`);
    expect(u[0].lastLoginAt).not.toBeNull();
  });

  it('GET /me with the session cookie resolves identity and permissions from the membership', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { cookies } = await login({ email: 'hr@example.com', password: PASSWORD });
    const me = await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ companyId: COMPANY_A, roles: ['HR_ADMIN'] });
    expect(me.body.data.permissions).toEqual(expect.arrayContaining([...ROLE_DEFAULT_PERMISSIONS.HR_ADMIN]));
  });

  it('wrong password, unknown email and a user with no password are all the same 401 and create no session', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    await seedUser({ email: 'nopass@example.com', password: null, memberships: [{ companyId: COMPANY_A }] });
    const bad = await login({ email: 'hr@example.com', password: 'wrong-password-1' });
    const unknown = await login({ email: 'ghost@example.com', password: PASSWORD });
    const nopass = await login({ email: 'nopass@example.com', password: PASSWORD });
    for (const r of [bad.res, unknown.res, nopass.res]) {
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Invalid email or password');
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(await sessionRows()).toHaveLength(0);
  });

  it('a disabled user cannot log in', async () => {
    await seedUser({ email: 'off@example.com', status: 'DISABLED', memberships: [{ companyId: COMPANY_A }] });
    expect((await login({ email: 'off@example.com', password: PASSWORD })).res.status).toBe(401);
  });

  it('companyId must be a UUID: "dev-company" is rejected by validation (not silently accepted)', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { res } = await login({ email: 'hr@example.com', password: PASSWORD, companyId: COMPANY_DEV });
    expect(res.status).toBe(400);
    expect(await sessionRows()).toHaveLength(0);
  });

  it('a user whose only membership is the non-UUID dev company can still log in (no companyId sent) and is scoped to it', async () => {
    await seedUser({ email: 'devco@example.com', memberships: [{ companyId: COMPANY_DEV }] });
    const { res, cookies } = await login({ email: 'devco@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.companyId).toBe(COMPANY_DEV);
    const me = await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies));
    expect(me.body.data.companyId).toBe(COMPANY_DEV);
  });

  it('a valid companyId where the user has no membership is the same 401 as a bad password', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { res } = await login({ email: 'hr@example.com', password: PASSWORD, companyId: COMPANY_B });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('multi-company users must choose; the session is bound to the chosen company only', async () => {
    await seedUser({ email: 'multi@example.com', memberships: [{ companyId: COMPANY_A }, { companyId: COMPANY_B }] });
    const ambiguous = await login({ email: 'multi@example.com', password: PASSWORD });
    expect(ambiguous.res.status).toBe(400);
    const { res, cookies } = await login({ email: 'multi@example.com', password: PASSWORD, companyId: COMPANY_B });
    expect(res.status).toBe(200);
    const me = await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies)).set('x-company-id', COMPANY_A);
    expect(me.body.data.companyId).toBe(COMPANY_B); // header hint ignored
  });

  it('a user with no ACTIVE membership cannot get a session (400 after a correct password, no session row)', async () => {
    await seedUser({ email: 'susp@example.com', memberships: [{ companyId: COMPANY_A, membershipStatus: 'SUSPENDED' }] });
    const { res } = await login({ email: 'susp@example.com', password: PASSWORD });
    expect(res.status).toBe(400);
    expect(await sessionRows()).toHaveLength(0);
  });

  it('rate-limits repeated attempts for one ip+email (6th attempt refused even with the right password)', async () => {
    await seedUser({ email: 'rl@example.com', memberships: [{ companyId: COMPANY_A }] });
    for (let i = 0; i < 5; i++) {
      expect((await login({ email: 'rl@example.com', password: 'wrong-password-1' })).res.status).toBe(401);
    }
    const sixth = await login({ email: 'rl@example.com', password: PASSWORD });
    expect(sixth.res.status).toBe(401);
    expect(sixth.res.body.error.message).toMatch(/Too many/);
  });
});

describe('session lifecycle', () => {
  async function session() {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { cookies } = await login({ email: 'hr@example.com', password: PASSWORD });
    const me = () => request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies));
    expect((await me()).status).toBe(200);
    return { cookies, me };
  }

  it('absolute expiry: an expired session is 401', async () => {
    const { me } = await session();
    await admin.query(`UPDATE hr.user_sessions SET "expiresAt" = (now() AT TIME ZONE 'utc') - interval '1 minute'`);
    expect((await me()).status).toBe(401);
  });

  it('idle expiry: no activity for over 8 hours is 401', async () => {
    const { me } = await session();
    await admin.query(`UPDATE hr.user_sessions SET "lastActivityAt" = (now() AT TIME ZONE 'utc') - interval '9 hours'`);
    expect((await me()).status).toBe(401);
  });

  it('activity refreshes lastActivityAt', async () => {
    const { me } = await session();
    await admin.query(`UPDATE hr.user_sessions SET "lastActivityAt" = (now() AT TIME ZONE 'utc') - interval '2 hours'`);
    await me();
    // Compared in SQL: these columns are timestamp WITHOUT time zone (stored as UTC by Prisma).
    const { rows } = await admin.query(
      `SELECT extract(epoch FROM ((now() AT TIME ZONE 'utc') - "lastActivityAt")) AS age FROM hr.user_sessions`,
    );
    expect(Number(rows[0].age)).toBeLessThan(60);
  });

  it('a tampered or unknown session cookie is 401', async () => {
    await session();
    const res = await request(app).get('/api/v1/me').set('cookie', 'gsc_session=not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('losing the membership after login is 403 (tenant is re-validated on every request)', async () => {
    const { me } = await session();
    await admin.query(`UPDATE hr.company_memberships SET status = 'SUSPENDED'`);
    expect((await me()).status).toBe(403);
  });

  it('disabling the user after login is 401', async () => {
    const { me } = await session();
    await admin.query(`UPDATE hr.users SET status = 'DISABLED'`);
    expect((await me()).status).toBe(401);
  });

  it('logout revokes the session server-side, clears cookies, and the old cookie stops working', async () => {
    const { cookies, me } = await session();
    const out = await request(app).post('/api/v1/auth/logout').set('cookie', cookieHeader(cookies));
    expect(out.status).toBe(204);
    expect(rawSetCookie(out, 'gsc_session')).toMatch(/Expires=Thu, 01 Jan 1970/);
    const [row] = await sessionRows();
    expect(row.revokedAt).not.toBeNull();
    expect((await me()).status).toBe(401);
  });

  it('password reset revokes all of the user\'s sessions', async () => {
    const { me } = await session();
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'hr@example.com' });
    const token = forgot.headers['x-development-reset-token'] as string;
    expect(token).toBeTruthy();
    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'a-brand-new-password' });
    expect(reset.status).toBe(200);
    expect((await me()).status).toBe(401);
    expect((await login({ email: 'hr@example.com', password: PASSWORD })).res.status).toBe(401);
    expect((await login({ email: 'hr@example.com', password: 'a-brand-new-password' })).res.status).toBe(200);
  });
});

describe('CSRF (mutating requests authenticated by the session cookie)', () => {
  const body = () => ({ employeeNumber: `E-${id().slice(0, 8)}`, firstName: 'Test', lastName: 'Person', workEmail: `${id().slice(0, 8)}@example.test`, joiningDate: '2026-01-05', departmentId: DEPT_A, designationId: DESIGNATION_A });
  async function session() {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    await admin.query(`INSERT INTO hr.designations (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineer',now()) ON CONFLICT (id) DO NOTHING`, [DESIGNATION_A, COMPANY_A]);
    return (await login({ email: 'hr@example.com', password: PASSWORD })).cookies;
  }
  const post = (cookies: Record<string, string>) =>
    request(app).post('/api/v1/employees').set('cookie', cookieHeader(cookies)).send(body());

  it('rejects a write with no CSRF header, a wrong header, and a header that does not match the cookie', async () => {
    const cookies = await session();
    expect((await post(cookies)).status).toBe(403);
    expect((await post(cookies).set('x-csrf-token', 'wrong')).status).toBe(403);
    const forged = { ...cookies, gsc_csrf: 'attacker-chosen' };
    expect((await post(forged).set('x-csrf-token', 'attacker-chosen')).status).toBe(403); // not the stored hash
  });

  it('accepts a write with the matching CSRF header (and the permission comes from the membership)', async () => {
    const cookies = await session();
    const res = await post(cookies).set('x-csrf-token', cookies.gsc_csrf!);
    expect(res.status).toBe(201);
  });

  it('a junk Authorization header must NOT bypass CSRF for a session-authenticated request', async () => {
    const cookies = await session();
    const res = await post(cookies).set('authorization', 'Bearer anything');
    expect(res.status).toBe(403);
  });

  it('GET requests need no CSRF header', async () => {
    const cookies = await session();
    expect((await request(app).get('/api/v1/employees').set('cookie', cookieHeader(cookies))).status).toBe(200);
  });
});

describe('the two authentication paths together (dev bearer vs session cookie)', () => {
  it('the dev bearer token works on its own and is unaffected by the existence of sessions', async () => {
    await seedUser({ email: 'devhr@example.com', externalId: 'dev-hr-admin', password: null, memberships: [{ companyId: COMPANY_A }] });
    const me = await request(app).get('/api/v1/me').set('authorization', 'Bearer dev:dev-hr-admin');
    expect(me.status).toBe(200);
    expect(me.body.data.companyId).toBe(COMPANY_A);
  });

  it('when both are sent the SESSION identity wins; the bearer token is ignored, not merged', async () => {
    await seedUser({ email: 'devhr@example.com', externalId: 'dev-hr-admin', password: null, memberships: [{ companyId: COMPANY_A }] });
    await seedUser({ email: 'sess@example.com', memberships: [{ companyId: COMPANY_B }] });
    const { cookies } = await login({ email: 'sess@example.com', password: PASSWORD });
    const me = await request(app)
      .get('/api/v1/me')
      .set('cookie', cookieHeader(cookies))
      .set('authorization', 'Bearer dev:dev-hr-admin');
    expect(me.body.data.companyId).toBe(COMPANY_B);
    expect(me.body.data.email).toBe('sess@example.com');
  });

  it('an invalid session cookie does not fall back to a valid bearer token (fail closed)', async () => {
    await seedUser({ email: 'devhr@example.com', externalId: 'dev-hr-admin', password: null, memberships: [{ companyId: COMPANY_A }] });
    const res = await request(app)
      .get('/api/v1/me')
      .set('cookie', 'gsc_session=stale')
      .set('authorization', 'Bearer dev:dev-hr-admin');
    expect(res.status).toBe(401);
  });

  it('a dev bearer token for a non-provisioned identity is 401', async () => {
    const res = await request(app).get('/api/v1/me').set('authorization', 'Bearer dev:someone-else');
    expect(res.status).toBe(401);
  });
});

describe('auditing', () => {
  it.todo('successful and failed logins and logouts are written to hr.audit_logs (currently NOT audited)');

  it('records what IS persisted today: sessions yes, audit_logs rows no', async () => {
    await seedUser({ email: 'hr@example.com', memberships: [{ companyId: COMPANY_A }] });
    const { cookies } = await login({ email: 'hr@example.com', password: PASSWORD });
    await request(app).post('/api/v1/auth/logout').set('cookie', cookieHeader(cookies));
    expect(await sessionRows()).toHaveLength(1);
    const { rows } = await appDb.query('SELECT count(*)::int AS n FROM hr.audit_logs');
    expect(rows[0].n).toBe(0); // documents the gap; flip this when auth auditing exists
  });
});
