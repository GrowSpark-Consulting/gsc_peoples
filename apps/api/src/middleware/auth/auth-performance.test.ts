import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../database/generated/client';
import { SessionAuthProvider, SESSION_ACTIVITY_WRITE_INTERVAL_MS } from '../../integrations/local-auth/session-provider';
import { cachedTokenHashAsync, clearTokenHashCache, TOKEN_HASH_CACHE_TTL_MS, tokenHashAsync } from '../../modules/auth/password';
import { requireCsrf } from './csrf';

beforeEach(() => clearTokenHashCache());

describe('cachedTokenHashAsync', () => {
  it('returns exactly the tokenHashAsync digest (stored session hashes stay valid)', async () => {
    expect(await cachedTokenHashAsync('tok-1')).toBe(await tokenHashAsync('tok-1'));
  });

  it('reuses the digest within the TTL and recomputes after it', async () => {
    const t0 = 1_000_000;
    const a = cachedTokenHashAsync('tok-2', t0);
    expect(cachedTokenHashAsync('tok-2', t0 + 1000)).toBe(a);
    const b = cachedTokenHashAsync('tok-2', t0 + TOKEN_HASH_CACHE_TTL_MS + 1);
    expect(b).not.toBe(a);
    expect(await b).toBe(await a);
  });
});

function sessionRow(lastActivityAt: Date) {
  return {
    id: 's1',
    companyId: 'c1',
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 3_600_000),
    lastActivityAt,
    csrfHash: 'csrf-hash',
    user: { externalId: 'ext-1', email: 'a@example.com', name: 'A', status: 'ACTIVE' },
  };
}

function fakePrisma(row: ReturnType<typeof sessionRow> | null) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue({});
  return { prisma: { userSession: { findUnique, update } } as unknown as PrismaClient, findUnique, update };
}

describe('SessionAuthProvider', () => {
  it('skips the lastActivityAt write when it was written within the interval', async () => {
    const { prisma, update } = fakePrisma(sessionRow(new Date(Date.now() - 5_000)));
    const identity = await new SessionAuthProvider(prisma).verifyToken('tok');
    expect(update).not.toHaveBeenCalled();
    expect(identity.sessionCsrfHash).toBe('csrf-hash');
  });

  it('writes lastActivityAt once the interval has passed', async () => {
    const { prisma, update } = fakePrisma(sessionRow(new Date(Date.now() - SESSION_ACTIVITY_WRITE_INTERVAL_MS - 1)));
    await new SessionAuthProvider(prisma).verifyToken('tok');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('still rejects revoked sessions on every request', async () => {
    const row = { ...sessionRow(new Date()), revokedAt: new Date() };
    const { prisma } = fakePrisma(row);
    await expect(new SessionAuthProvider(prisma).verifyToken('tok')).rejects.toThrow('Session expired');
  });
});

describe('requireCsrf with the session row from authenticate', () => {
  const run = async (req: Partial<Request>, prisma: PrismaClient) => {
    const next = vi.fn();
    await requireCsrf(prisma)(req as Request, {} as Response, next);
    return next;
  };
  const request = (csrf: string, sessionCsrfHash: string) =>
    ({
      method: 'PATCH',
      authMethod: 'session',
      sessionCsrfHash,
      headers: { cookie: `gsc_session=sess; gsc_csrf=${csrf}` },
      header: (name: string) => (name === 'x-csrf-token' ? csrf : undefined),
    }) as unknown as Partial<Request>;

  it('accepts a matching token without reading the session again', async () => {
    const { prisma, findUnique } = fakePrisma(null);
    const next = await run(request('good', await tokenHashAsync('good')), prisma);
    expect(next).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a token whose hash does not match the validated row', async () => {
    const { prisma } = fakePrisma(null);
    await expect(run(request('forged', await tokenHashAsync('good')), prisma)).rejects.toThrow('CSRF validation failed');
  });
});
