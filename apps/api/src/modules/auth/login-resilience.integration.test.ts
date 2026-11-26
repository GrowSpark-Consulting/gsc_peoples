import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { Express } from 'express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../database/generated/client';
import { connect, testUrl } from '../../test/integration/helpers';
import { resetData } from '../../test/integration/seed';
import { hashPassword } from './password';

/**
 * Login behaviour when the database is unavailable, slow, or comes back (production incident: intermittent 502s on
 * POST /auth/login while the API was cold). The app's database URL points at a local TCP proxy in front of the
 * scratch database, so each failure mode is deterministic:
 *   refuse  - the connection is reset immediately (database down / restarting)
 *   hang    - the TCP connection is accepted but nothing is ever answered (cold or black-holed server)
 *   forward - normal operation
 * Only the throwaway scratch database is ever reached (helpers.testUrl enforces it).
 */

type Mode = 'refuse' | 'hang' | 'forward';
const PASSWORD = 'correct-horse-battery';
const COMPANY = randomUUID();

let mode: Mode = 'forward';
let proxy: net.Server;
const sockets = new Set<net.Socket>();
let admin: pg.Client;
let app: Express;
let disconnect: () => Promise<void>;
let getPrisma: () => PrismaClient;

function startProxy(target: { host: string; port: number }): Promise<number> {
  proxy = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => undefined);
    if (mode === 'refuse') return client.resetAndDestroy();
    if (mode === 'hang') return; // accepted, never answered
    const upstream = net.connect(target.port, target.host);
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.pipe(upstream).pipe(client);
  });
  return new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as net.AddressInfo).port)));
}

/** Simulates the database going away: drops every open connection and refuses new ones. */
function setMode(next: Mode) {
  mode = next;
  if (next !== 'forward') for (const s of sockets) s.destroy();
}

async function seedUser(email: string, opts: { status?: 'ACTIVE' | 'DISABLED'; role?: string } = {}) {
  const userId = randomUUID();
  await admin.query(
    `INSERT INTO hr.users (id,"externalId",email,name,"passwordHash",status,"updatedAt") VALUES ($1,$1,$2,'U',$3,$4,now())`,
    [userId, email, hashPassword(PASSWORD), opts.status ?? 'ACTIVE'],
  );
  const { rows } = await admin.query(`SELECT id FROM hr.roles WHERE "companyId"=$1 AND key=$2`, [COMPANY, opts.role ?? 'HR_ADMIN']);
  await admin.query(
    `INSERT INTO hr.company_memberships (id,"companyId","userId","roleId",status,"updatedAt") VALUES ($1,$2,$3,$4,'ACTIVE',now())`,
    [randomUUID(), COMPANY, userId, rows[0].id],
  );
  return userId;
}

const login = (email: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD, ...extra });

const sessionCount = async () => (await admin.query('SELECT count(*)::int AS n FROM hr.user_sessions')).rows[0].n as number;

function expectServiceUnavailable(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(503);
  expect(res.headers['retry-after']).toBe('5');
  expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  expect(res.body.error.requestId).toBeTruthy();
  expect(res.headers['set-cookie']).toBeUndefined();
  // Never a driver or Prisma message, host, role or connection string.
  const raw = JSON.stringify(res.body);
  for (const leak of ['prisma', 'ECONN', 'timeout exceeded', 'postgres', 'hr_app', '127.0.0.1', 'invocation']) expect(raw).not.toContain(leak);
}

beforeAll(async () => {
  const realUrl = new URL(testUrl('TEST_DATABASE_URL')); // validated scratch database on a local host
  admin = await connect('TEST_DIRECT_URL');
  const port = await startProxy({ host: realUrl.hostname, port: Number(realUrl.port || 5432) });
  const proxied = new URL(realUrl);
  proxied.hostname = '127.0.0.1';
  proxied.port = String(port);
  process.env.DATABASE_URL = proxied.toString();
  const { createApp } = await import('../../app');
  const client = await import('../../database/client');
  getPrisma = client.getPrisma;
  disconnect = client.disconnectDatabase;
  app = createApp();
});

afterAll(async () => {
  setMode('refuse');
  await disconnect?.();
  await new Promise((r) => proxy?.close(r));
  await admin?.end();
});

beforeEach(async () => {
  setMode('forward');
  await resetData(admin);
  await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ($1,$1,now())`, [COMPANY]);
  for (const key of ['HR_ADMIN', 'EMPLOYEE']) {
    await admin.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [randomUUID(), COMPANY, key]);
  }
});

describe('credentials (database healthy)', () => {
  it('correct credentials: 200 with session cookies', async () => {
    await seedUser('ok@example.com');
    const res = await login('ok@example.com');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/gsc_session=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/gsc_csrf=/);
  });

  it('wrong password, unknown email, disabled account and wrong selected role are all 401 (never 5xx)', async () => {
    await seedUser('hr@example.com');
    await seedUser('off@example.com', { status: 'DISABLED' });
    const results = [
      await request(app).post('/api/v1/auth/login').send({ email: 'hr@example.com', password: 'wrong-password-1' }),
      await login('nobody@example.com'),
      await login('off@example.com'),
      await login('hr@example.com', { roleKey: 'EMPLOYEE' }), // has HR_ADMIN only: the role is checked, never chosen
    ];
    for (const res of results) {
      expect(res.status, JSON.stringify(res.body)).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(await sessionCount()).toBe(0);
  });

  it('concurrent logins for different users all succeed with distinct sessions', async () => {
    const emails = Array.from({ length: 8 }, (_, i) => `c${i}@example.com`);
    for (const e of emails) await seedUser(e);
    const results = await Promise.all(emails.map((e) => login(e)));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await sessionCount()).toBe(8);
    const { rows } = await admin.query('SELECT count(DISTINCT "tokenHash")::int AS n FROM hr.user_sessions');
    expect(rows[0].n).toBe(8);
  });

  it('repeated logins after the pool has been idle succeed', async () => {
    await seedUser('idle@example.com');
    expect((await login('idle@example.com')).status).toBe(200);
    setMode('refuse'); // drops every pooled connection, like a pooler closing idle connections
    setMode('forward');
    for (let i = 0; i < 3; i++) expect((await login('idle@example.com')).status).toBe(200);
  });
});

describe('database unavailable', () => {
  it('connection refused: login answers 503 + Retry-After quickly, without leaking driver details', async () => {
    await seedUser('down@example.com');
    setMode('refuse');
    const started = Date.now();
    const res = await login('down@example.com');
    expectServiceUnavailable(res);
    expect(Date.now() - started).toBeLessThan(6_000);
  });

  it('connection never answered: login answers 503 after the 5 s connect timeout (not a hang)', async () => {
    await seedUser('hang@example.com');
    setMode('hang');
    const started = Date.now();
    const res = await login('hang@example.com');
    const ms = Date.now() - started;
    expectServiceUnavailable(res);
    expect(ms).toBeGreaterThanOrEqual(4_500);
    expect(ms).toBeLessThan(9_000);
  });

  it('liveness stays 200 while readiness reports 503 during the outage', async () => {
    setMode('refuse');
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.dependencies.database).toBe('down');
  });

  it('startup check while the database is down logs and returns instead of throwing; it succeeds once it is back', async () => {
    const { checkDatabaseConnectivity } = await import('../../database/startup');
    const logs: { level: string; obj: Record<string, unknown> }[] = [];
    const log = { info: (obj: object) => logs.push({ level: 'info', obj: obj as Record<string, unknown> }), warn: (obj: object) => logs.push({ level: 'warn', obj: obj as Record<string, unknown> }) };
    setMode('refuse');
    const down = await checkDatabaseConnectivity(() => getPrisma().$queryRaw`SELECT 1`, log);
    expect(down.ok).toBe(false);
    setMode('forward');
    const up = await checkDatabaseConnectivity(() => getPrisma().$queryRaw`SELECT 1`, log);
    expect(up.ok).toBe(true);
    expect(logs.map((l) => l.level)).toEqual(['warn', 'info']);
    expect(JSON.stringify(logs)).not.toMatch(/postgres(ql)?:\/\/[^[]/);
  });

  it('recovers without a restart: login works again as soon as the database is reachable', async () => {
    await seedUser('back@example.com');
    setMode('refuse');
    expectServiceUnavailable(await login('back@example.com'));
    setMode('forward');
    const res = await login('back@example.com');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await sessionCount()).toBe(1);
    expect((await request(app).get('/api/v1/health/ready')).status).toBe(200);
  });

  it('an authenticated request during an outage is 503, not 401 (the session is not discarded)', async () => {
    await seedUser('me@example.com');
    const ok = await login('me@example.com');
    const cookie = (ok.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    setMode('refuse');
    expectServiceUnavailable(await request(app).get('/api/v1/me').set('cookie', cookie));
    setMode('forward');
    expect((await request(app).get('/api/v1/me').set('cookie', cookie)).status).toBe(200);
  });
});

describe('per-account login limiter (5 failed attempts per 15 minutes per IP + normalized email)', () => {
  const wrong = (email: string) => request(app).post('/api/v1/auth/login').send({ email, password: 'wrong-password-1' });
  const isTooMany = (res: request.Response) => res.status === 401 && /Too many/.test(res.body.error?.message ?? '');

  it('repeated database outages never lock out a legitimate user', async () => {
    await seedUser('outage@example.com');
    setMode('refuse');
    for (let i = 0; i < 12; i++) {
      const res = await login('outage@example.com');
      expectServiceUnavailable(res); // 503 every time, never "Too many login attempts"
    }
    setMode('forward');
    const res = await login('outage@example.com');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('connection timeouts do not count either', async () => {
    await seedUser('slow@example.com');
    for (let i = 0; i < 4; i++) expect((await wrong('slow@example.com')).status).toBe(401); // 4 genuine failures
    setMode('hang');
    expectServiceUnavailable(await login('slow@example.com')); // ~5 s connect timeout: not counted
    setMode('forward');
    expect((await login('slow@example.com')).status).toBe(200); // the 5th attempt was still available
  });

  it('genuine invalid credentials keep counting across outages: 4 wrong + outages + 1 wrong = locked', async () => {
    await seedUser('mixed@example.com');
    for (let i = 0; i < 4; i++) expect((await wrong('mixed@example.com')).status).toBe(401);
    setMode('refuse');
    for (let i = 0; i < 3; i++) expectServiceUnavailable(await wrong('mixed@example.com'));
    setMode('forward');
    const fifth = await wrong('mixed@example.com');
    expect(fifth.body.error.message).toBe('Invalid email or password');
    expect(isTooMany(await login('mixed@example.com'))).toBe(true); // even the right password is refused now
  });

  it('cannot be bypassed by changing the email casing or adding whitespace', async () => {
    await seedUser('lock@example.com');
    for (const variant of ['lock@example.com', 'Lock@Example.com', 'LOCK@EXAMPLE.COM', 'lOcK@eXaMpLe.CoM', 'lock@EXAMPLE.com']) {
      const res = await wrong(variant);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    }
    for (const variant of ['lock@example.com', 'LOCK@example.com', '  lock@example.com  ', '\tLock@Example.Com\n']) {
      const res = await login(variant);
      expect(res.status, `${JSON.stringify(variant)} -> ${res.status} ${JSON.stringify(res.body)}`).not.toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      // Either refused by validation (never reaches a password check) or by the shared counter.
      if (res.status !== 400) expect(isTooMany(res)).toBe(true);
    }
    expect(await sessionCount()).toBe(0);
  });

  it('concurrent wrong passwords cannot slip past the limit (attempts are reserved before the password check)', async () => {
    await seedUser('burst@example.com');
    const results = await Promise.all(Array.from({ length: 12 }, () => wrong('burst@example.com')));
    const invalid = results.filter((r) => r.body.error?.message === 'Invalid email or password');
    expect(invalid).toHaveLength(5);
    expect(results.filter(isTooMany)).toHaveLength(7);
    expect(isTooMany(await login('burst@example.com'))).toBe(true);
  });

  it('unknown emails are limited the same way (no account enumeration through the limiter)', async () => {
    for (let i = 0; i < 5; i++) expect((await wrong('Ghost@Example.com')).body.error.message).toBe('Invalid email or password');
    expect(isTooMany(await wrong('ghost@example.com'))).toBe(true);
  });
});
