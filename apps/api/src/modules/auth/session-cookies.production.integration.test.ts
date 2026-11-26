import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EnvModule from '../../config/env';
import type { Env } from '../../config/env';
import { connect, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from './password';

/**
 * Session cookies, CSRF and session behaviour under the PRODUCTION configuration.
 *
 * The environment is produced by the real `parseEnv` from a production-shaped variable set (the same keys render.yaml
 * declares, with placeholder values), so every production validation rule runs. Only the infrastructure endpoints are
 * then pointed at local stand-ins so the test can run: the database is the local throwaway scratch database (no TLS,
 * DB_TARGET=local), documents use the local driver and email is disabled. NODE_ENV, AUTH_MODE and the cookie settings
 * stay exactly as parsed.
 */

const PRODUCTION_VARS = {
  NODE_ENV: 'production',
  AUTH_MODE: 'session',
  DB_TARGET: 'supabase',
  LOG_LEVEL: 'silent',
  SUPABASE_DATABASE_URL: 'postgresql://hr_app.placeholder:placeholder@pooler.invalid:5432/postgres',
  SUPABASE_CA_CERT_PATH: path.resolve(import.meta.dirname, '../../../../../supabase-ca.crt'),
  DOCUMENT_STORAGE_DRIVER: 'supabase',
  SUPABASE_STORAGE_BUCKET: 'hr-documents',
  SUPABASE_STORAGE_URL: 'https://placeholder.supabase.co',
  SUPABASE_STORAGE_SERVICE_KEY: 'placeholder',
  MAIL_DRIVER: 'smtp',
  SMTP_HOST: 'smtp.invalid',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: 'placeholder',
  SMTP_PASSWORD: 'placeholder',
  MAIL_FROM: 'GSC Peoples <no-reply@example.com>',
  WEB_APP_URL: 'https://gsc-peoples.vercel.app',
  CORS_ORIGINS: 'https://gsc-peoples.vercel.app',
};

const holder = vi.hoisted(() => ({ parsed: undefined as unknown }));

vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  const { testUrl: scratchUrl } = await import('../../test/integration/helpers');
  const parsed = actual.parseEnv(PRODUCTION_VARS as unknown as NodeJS.ProcessEnv);
  holder.parsed = { ...parsed };
  const env = { ...parsed, DB_TARGET: 'local', DATABASE_URL: scratchUrl('TEST_DATABASE_URL'), DOCUMENT_STORAGE_DRIVER: 'local', MAIL_DRIVER: 'disabled' };
  return { ...actual, env };
});

const PASSWORD = 'correct-horse-battery';
const COMPANY = randomUUID();
let admin: pg.Client;
let app: Express;
let env: Env;
let disconnect: () => Promise<void>;
let ipCounter = 0;
/** A distinct client IP per test (trust proxy = 1 in production), so the per-IP limiter never interferes. */
let clientIp = '';

const cookieMap = (res: request.Response) =>
  Object.fromEntries(
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      return [pair!.slice(0, i), decodeURIComponent(pair!.slice(i + 1))];
    }),
  ) as Record<string, string>;
const rawCookie = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) => c.startsWith(`${name}=`)) ?? '';
const attrs = (raw: string) => raw.split(';').slice(1).map((a) => a.trim().toLowerCase());
const cookieHeader = (c: Record<string, string>) => `gsc_session=${encodeURIComponent(c.gsc_session!)}; gsc_csrf=${encodeURIComponent(c.gsc_csrf!)}`;

const login = () =>
  request(app).post('/api/v1/auth/login').set('x-forwarded-for', clientIp).send({ email: 'hr@example.com', password: PASSWORD });

async function seedUser() {
  const userId = randomUUID();
  await admin.query(`INSERT INTO hr.users (id,"externalId",email,name,"passwordHash","updatedAt") VALUES ($1,$1,'hr@example.com','HR',$2,now())`, [userId, hashPassword(PASSWORD)]);
  const { rows } = await admin.query(`SELECT id FROM hr.roles WHERE "companyId"=$1`, [COMPANY]);
  await admin.query(`INSERT INTO hr.company_memberships (id,"companyId","userId","roleId",status,"updatedAt") VALUES ($1,$2,$3,$4,'ACTIVE',now())`, [randomUUID(), COMPANY, userId, rows[0].id]);
}

beforeAll(async () => {
  testUrl('TEST_DATABASE_URL'); // guard: scratch database on a local host only
  admin = await connect('TEST_DIRECT_URL');
  ({ env } = await import('../../config/env'));
  const { createApp } = await import('../../app');
  const client = await import('../../database/client');
  disconnect = client.disconnectDatabase;
  app = createApp();
});

afterAll(async () => {
  await disconnect?.();
  await admin?.end();
});

beforeEach(async () => {
  clientIp = `203.0.113.${++ipCounter}`;
  env.COOKIE_DOMAIN = undefined;
  await resetData(admin);
  await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,$1,now())`, [COMPANY]);
  await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,'HR_ADMIN','HR Admin',true,now())`, [randomUUID(), COMPANY]);
  await seedUser();
});

describe('production configuration', () => {
  it('is the real production parse (only infrastructure endpoints replaced)', () => {
    const parsed = holder.parsed as Env;
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.AUTH_MODE).toBe('session');
    expect(parsed.COOKIE_DOMAIN).toBeUndefined(); // render.yaml: leave empty for *.vercel.app + *.onrender.com
    expect(env.NODE_ENV).toBe('production');
    expect(env.AUTH_MODE).toBe('session');
  });
});

describe('session cookies (production)', () => {
  it('login sets gsc_session as HttpOnly + Secure + SameSite=Lax, host-only, Path=/, 8 h', async () => {
    const res = await login();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const session = attrs(rawCookie(res, 'gsc_session'));
    expect(session).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'path=/', 'max-age=28800']));
    expect(session.some((a) => a.startsWith('domain='))).toBe(false); // host-only: never set on a public suffix
  });

  it('gsc_csrf is Secure + SameSite=Lax but readable by the page (not HttpOnly), so it can be echoed in a header', async () => {
    const res = await login();
    const csrf = attrs(rawCookie(res, 'gsc_csrf'));
    expect(csrf).toEqual(expect.arrayContaining(['secure', 'samesite=lax', 'path=/', 'max-age=28800']));
    expect(csrf).not.toContain('httponly');
    expect(csrf.some((a) => a.startsWith('domain='))).toBe(false);
  });

  it('with COOKIE_DOMAIN set (shared custom parent domain) both cookies carry that Domain', async () => {
    env.COOKIE_DOMAIN = '.example.com';
    const res = await login();
    for (const name of ['gsc_session', 'gsc_csrf']) expect(attrs(rawCookie(res, name))).toContain('domain=.example.com');
  });

  it('logout clears both cookies with the same attributes (Domain, Path, Secure, SameSite) and revokes the session', async () => {
    env.COOKIE_DOMAIN = '.example.com';
    const cookies = cookieMap(await login());
    const out = await request(app).post('/api/v1/auth/logout').set('x-forwarded-for', clientIp).set('cookie', cookieHeader(cookies));
    expect(out.status).toBe(204);
    for (const name of ['gsc_session', 'gsc_csrf']) {
      const a = attrs(rawCookie(out, name));
      expect(a).toEqual(expect.arrayContaining(['path=/', 'domain=.example.com', 'secure', 'samesite=lax']));
      expect(a.some((x) => x.startsWith('expires=thu, 01 jan 1970'))).toBe(true);
    }
    expect((await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies))).status).toBe(401);
  });

  it('no development token headers are exposed in production', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').set('x-forwarded-for', clientIp).send({ email: 'hr@example.com' });
    expect(res.status).toBe(200);
    expect(res.headers['x-development-reset-token']).toBeUndefined();
  });
});

describe('session behaviour and CSRF (production)', () => {
  // A mutating request behind authentication + CSRF to a path no router handles: 403 = stopped by CSRF,
  // 404 = CSRF passed and the request reached routing. Nothing is written.
  const mutate = (cookies: Record<string, string>) =>
    request(app).post('/api/v1/csrf-probe').set('x-forwarded-for', clientIp).set('cookie', cookieHeader(cookies)).send({});

  it('the session cookie authenticates GET /me; a tampered cookie is 401', async () => {
    const cookies = cookieMap(await login());
    const me = await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies));
    expect(me.status).toBe(200);
    expect(me.body.data.companyId).toBe(COMPANY);
    expect((await request(app).get('/api/v1/me').set('cookie', 'gsc_session=tampered')).status).toBe(401);
  });

  it('mutations need the CSRF header matching the cookie AND the stored hash', async () => {
    const cookies = cookieMap(await login());
    expect((await mutate(cookies)).status).toBe(403); // no header
    expect((await mutate(cookies).set('x-csrf-token', 'wrong')).status).toBe(403); // header != cookie
    const forged = { ...cookies, gsc_csrf: 'attacker-chosen' };
    expect((await mutate(forged).set('x-csrf-token', 'attacker-chosen')).status).toBe(403); // matches cookie, not the stored hash
    expect((await mutate(cookies).set('x-csrf-token', cookies.gsc_csrf!)).status).toBe(404); // CSRF passed
  });

  it('a bearer token is not accepted in session mode, and does not bypass CSRF for a cookie request', async () => {
    expect((await request(app).get('/api/v1/me').set('authorization', 'Bearer dev:dev-hr-admin')).status).toBe(401);
    const cookies = cookieMap(await login());
    expect((await mutate(cookies).set('authorization', 'Bearer anything')).status).toBe(403);
  });

  it('an expired session is 401', async () => {
    const cookies = cookieMap(await login());
    await admin.query(`UPDATE hr.user_sessions SET "expiresAt" = (now() AT TIME ZONE 'utc') - interval '1 minute'`);
    expect((await request(app).get('/api/v1/me').set('cookie', cookieHeader(cookies))).status).toBe(401);
  });
});
