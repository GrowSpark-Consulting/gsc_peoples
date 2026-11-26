import { describe, expect, it, vi } from 'vitest';
import { classifyDatabaseError, safeDatabaseErrorFields } from './errors';
import { checkDatabaseConnectivity } from './startup';

/** Shapes copied from the real errors observed with Prisma 7.10 + adapter-pg 7.10 + pg 8.23 (see errors.ts). */
const prismaKnown = (code: string, meta?: Record<string, unknown>) =>
  Object.assign(new Error('Invalid `prisma.user.findFirst()` invocation:\n\n\nsomething'), { name: 'PrismaClientKnownRequestError', code, meta });
const rawWrapped = (cause: Record<string, unknown>) => prismaKnown('P2010', { driverAdapterError: { name: 'DriverAdapterError', cause } });

describe('classifyDatabaseError', () => {
  it.each([
    ['connection refused (model query)', prismaKnown('ECONNREFUSED', { modelName: 'User' }), 'unreachable'],
    ['DNS failure (P1001)', prismaKnown('P1001', { driverAdapterError: { cause: { kind: 'DatabaseNotReachable' } } }), 'unreachable'],
    ['bad credentials (P1000)', prismaKnown('P1000'), 'unavailable'],
    ['pool timeout (P2024)', prismaKnown('P2024'), 'acquire_timeout'],
    ['transaction timeout (P2028 with meta.timeout)', prismaKnown('P2028', { timeout: 5000, timeTaken: 6000 }), 'transaction_timeout'],
    ['statement_timeout via raw query', rawWrapped({ kind: 'postgres', originalCode: '57014' }), 'query_timeout'],
    ['admin shutdown via raw query', rawWrapped({ kind: 'postgres', originalCode: '57P01' }), 'unavailable'],
    ['connection closed via raw query', rawWrapped({ kind: 'ConnectionClosed' }), 'connection_lost'],
    ['pg-pool acquire timeout (plain Error)', new Error('timeout exceeded when trying to connect'), 'acquire_timeout'],
    ['pg-pool connect timeout (plain Error)', new Error('Connection terminated due to connection timeout', { cause: new Error('Connection terminated unexpectedly') }), 'connect_timeout'],
    ['pg query_timeout (plain Error)', new Error('Query read timeout'), 'query_timeout'],
    ['Node socket error', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }), 'unreachable'],
    ['pg DatabaseError too_many_connections', Object.assign(new Error('sorry, too many clients'), { code: '53300', severity: 'FATAL' }), 'unavailable'],
    ['wrapped in a cause', new Error('outer', { cause: new Error('Query read timeout') }), 'query_timeout'],
  ])('%s', (_label, err, kind) => {
    expect(classifyDatabaseError(err)).toBe(kind);
  });

  it.each([
    ['record not found (P2025)', prismaKnown('P2025', { modelName: 'User' })],
    ['unique violation (P2002)', prismaKnown('P2002')],
    ['missing table via raw query', rawWrapped({ kind: 'TableDoesNotExist', originalCode: '42P01' })],
    ['other SQL error via raw query', rawWrapped({ kind: 'postgres', originalCode: '22P02' })],
    ['P2028 without a timeout (misuse, not unavailability)', prismaKnown('P2028', {})],
    ['an ordinary bug', new TypeError('cannot read properties of undefined')],
    ['a message that merely contains a driver phrase', new Error('user said: Query read timeout!')],
    ['an application error carrying a SQLSTATE-looking code but no severity', Object.assign(new Error('x'), { code: '57014' })],
    ['not an error', 'boom'],
    ['null', null],
  ])('%s is NOT a database outage', (_label, err) => {
    expect(classifyDatabaseError(err)).toBeUndefined();
  });
});

describe('safeDatabaseErrorFields', () => {
  it('never contains a connection string or password', () => {
    const err = Object.assign(new Error('could not connect: postgresql://hr_app:s3cret-pw@db.example.com:5432/postgres?schema=hr'), { code: 'ECONNREFUSED' });
    const out = JSON.stringify(safeDatabaseErrorFields(err));
    expect(out).not.toContain('s3cret-pw');
    expect(out).not.toContain('hr_app:');
    expect(out).toContain('postgresql://[redacted]');
    expect(out).toContain('ECONNREFUSED');
  });

  it('keeps only the last line of a Prisma message (no query or argument dump)', () => {
    const err = prismaKnown('P1001');
    err.message = 'Invalid `prisma.user.findFirst()` invocation:\n{ where: { email: "person@example.com" } }\nCan\'t reach database server';
    const out = safeDatabaseErrorFields(err);
    expect(out.message).toBe("Can't reach database server");
    expect(JSON.stringify(out)).not.toContain('person@example.com');
  });
});

describe('checkDatabaseConnectivity (startup)', () => {
  it('logs success with the latency and resolves ok', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const result = await checkDatabaseConnectivity(async () => 1, log);
    expect(result.ok).toBe(true);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'db.startup_check', ok: true }), expect.any(String));
  });

  it('does not throw when the database is down, and logs the classified failure without secrets', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const failing = () => Promise.reject(Object.assign(new Error('connect to postgresql://u:topsecret@h/db failed'), { code: 'ECONNREFUSED' }));
    const result = await checkDatabaseConnectivity(failing, log);
    expect(result).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('topsecret');
  });
});
