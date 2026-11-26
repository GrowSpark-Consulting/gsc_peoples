import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { testUrl } from '../test/integration/helpers';
import { errorHandler } from '../middleware/error/error-handler';
import { createPrismaClient, poolConfig, DATABASE_TIMEOUTS } from './client';
import { classifyDatabaseError } from './errors';
import type { PrismaClient } from './generated/client';

/**
 * Real driver behaviour behind the database error classification (scratch database only). These lock the exact
 * errors pg 8.23 / pg-pool 3.14 / Prisma 7.10 produce, so a dependency upgrade that changes them fails here instead of
 * silently turning a 503 back into a 500.
 */

const url = testUrl('TEST_DATABASE_URL');
const clients: PrismaClient[] = [];
const make = (opts: Parameters<typeof createPrismaClient>[1]) => {
  const c = createPrismaClient(url, opts);
  clients.push(c);
  return c;
};
const failure = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a failure');
};

afterAll(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
});

describe('pool configuration', () => {
  it('uses bounded connect, statement, query and idle timeouts with TCP keep-alive', () => {
    const cfg = poolConfig('postgresql://u@localhost/db');
    expect(cfg).toMatchObject({
      connectionTimeoutMillis: 5_000,
      query_timeout: 15_000,
      idleTimeoutMillis: 60_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    expect(DATABASE_TIMEOUTS.statementTimeoutMillis).toBe(10_000);
    expect(DATABASE_TIMEOUTS.queryTimeoutMillis).toBeGreaterThan(DATABASE_TIMEOUTS.statementTimeoutMillis);
  });

  it('every connection carries the server-side statement_timeout', async () => {
    const c = make({});
    const rows = await c.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    expect(rows[0]?.statement_timeout).toBe('10s');
  });
});

describe('query timeouts', () => {
  it('server statement_timeout cancels a slow statement; classified as query_timeout; the connection stays usable', async () => {
    const c = make({ max: 1, timeouts: { statementTimeoutMillis: 200 } });
    const err = await failure(() => c.$queryRaw`SELECT pg_sleep(2)::text`);
    expect(classifyDatabaseError(err)).toBe('query_timeout');
    expect(await c.$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
  });

  it('client query_timeout backstop fires when the server does not answer; classified as query_timeout; the pool recovers', async () => {
    const c = make({ max: 1, timeouts: { statementTimeoutMillis: 60_000, queryTimeoutMillis: 300 } });
    const err = await failure(() => c.$queryRaw`SELECT pg_sleep(1.5)::text`);
    expect((err as Error).message).toBe('Query read timeout');
    expect(classifyDatabaseError(err)).toBe('query_timeout');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await c.$queryRaw`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
  });

  it('pool exhaustion fails after connectionTimeoutMillis instead of waiting forever; classified as acquire_timeout', async () => {
    const c = make({ max: 1, timeouts: { connectionTimeoutMillis: 300 } });
    const hold = c.$transaction(async (tx) => { await tx.$queryRaw`SELECT pg_sleep(1)::text`; }, { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    const err = await failure(() => c.user.count());
    expect(Date.now() - started).toBeLessThan(1_000);
    expect((err as Error).message).toBe('timeout exceeded when trying to connect');
    expect(classifyDatabaseError(err)).toBe('acquire_timeout');
    await hold;
  });

  it('a timed-out query reaching the error handler is a 503 with Retry-After and no driver detail', async () => {
    const c = make({ timeouts: { statementTimeoutMillis: 100 } });
    const app = express();
    app.get('/slow', async () => {
      await c.$queryRaw`SELECT pg_sleep(1)::text`;
    });
    app.get('/sql-bug', async () => {
      await c.$queryRawUnsafe('SELECT * FROM no_such_table_for_test');
    });
    app.use(errorHandler);
    const slow = await request(app).get('/slow');
    expect(slow.status).toBe(503);
    expect(slow.headers['retry-after']).toBe('5');
    expect(JSON.stringify(slow.body)).not.toMatch(/57014|statement timeout|pg_sleep/);
    // An ordinary SQL error is still a 500 (a bug), not disguised as an outage. (Production masks its message; see
    // error-handler.test.ts.)
    const bug = await request(app).get('/sql-bug');
    expect(bug.status).toBe(500);
    expect(bug.headers['retry-after']).toBeUndefined();
    expect(bug.body.error.code).toBe('INTERNAL_ERROR');
  });
});
