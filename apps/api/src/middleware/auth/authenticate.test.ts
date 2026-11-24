import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { CentralAuthProvider, VerifiedIdentity } from '../../integrations/central-auth';
import { UnauthorizedError } from '../../shared/errors';
import { authenticate } from './authenticate';

function fakeProvider(label: string): CentralAuthProvider & { verifyToken: ReturnType<typeof vi.fn> } {
  return {
    kind: 'development',
    verifyToken: vi.fn((token: string) => {
      if (token === 'bad') return Promise.reject(new UnauthorizedError('Invalid token'));
      return Promise.resolve<VerifiedIdentity>({ externalId: `${label}:${token}`, companyId: 'c1' });
    }),
    resolveAccess: () => Promise.resolve({ roles: [], permissions: [] }),
    syncUser: vi.fn(() => Promise.resolve()),
  };
}

function fakeReq(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower[name.toLowerCase()], headers: lower } as unknown as Request;
}

async function run(
  headers: Record<string, string>,
  provider: CentralAuthProvider,
  sessionProvider?: CentralAuthProvider,
) {
  const req = fakeReq(headers);
  const next = vi.fn();
  let error: unknown = null;
  try {
    await authenticate(provider, sessionProvider)(req, {} as never, next);
  } catch (e) {
    error = e;
  }
  return { req, next, error };
}

describe('authenticate', () => {
  it('rejects a request with no token and no session (401) without calling a provider', async () => {
    const provider = fakeProvider('p');
    const { error, next } = await run({}, provider);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(provider.verifyToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a session cookie when no session provider is configured, never calling verifyToken(undefined)', async () => {
    const provider = fakeProvider('p');
    const { error, next } = await run({ cookie: 'gsc_session=abc' }, provider);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(provider.verifyToken).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token with 401', async () => {
    const provider = fakeProvider('p');
    const { error, next } = await run({ authorization: 'Bearer bad' }, provider);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid session with 401 and does not fall back to the bearer provider', async () => {
    const provider = fakeProvider('p');
    const session = fakeProvider('s');
    const { error } = await run({ cookie: 'gsc_session=bad' }, provider, session);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(provider.verifyToken).not.toHaveBeenCalled();
  });

  it('accepts a valid bearer token through the configured provider', async () => {
    const provider = fakeProvider('p');
    const { req, error, next } = await run({ authorization: 'Bearer tok' }, provider);
    expect(error).toBeNull();
    expect(req.identity).toMatchObject({ externalId: 'p:tok' });
    expect(req.authMethod).toBe('bearer');
    expect(provider.syncUser).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts a valid session cookie through the session provider', async () => {
    const provider = fakeProvider('p');
    const session = fakeProvider('s');
    const { req, error, next } = await run({ cookie: 'a=1; gsc_session=abc%20d' }, provider, session);
    expect(error).toBeNull();
    expect(req.identity).toMatchObject({ externalId: 's:abc d' });
    expect(req.authMethod).toBe('session'); // CSRF applies to this one
    expect(session.verifyToken).toHaveBeenCalledWith('abc d');
    expect(session.syncUser).toHaveBeenCalledOnce(); // synced by the provider that verified it
    expect(provider.syncUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('falls back to a bearer token when a session cookie is present but no session provider exists', async () => {
    const provider = fakeProvider('p');
    const { req, error } = await run({ cookie: 'gsc_session=abc', authorization: 'Bearer tok' }, provider);
    expect(error).toBeNull();
    expect(req.identity).toMatchObject({ externalId: 'p:tok' });
    expect(req.authMethod).toBe('bearer');
  });
});
