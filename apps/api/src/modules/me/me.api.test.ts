import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { meResponseSchema } from '@gsc/contracts';
import { createApp } from '../../app';
import type { CentralAuthProvider } from '../../integrations/central-auth';
import type { MembershipResolver } from '../../middleware/auth/resolve-tenant';
import { UnauthorizedError } from '../../shared/errors';

const provider: CentralAuthProvider = {
  kind: 'development',
  verifyToken: (t) => {
    const [prefix, externalId, companyId] = t.split(':');
    if (prefix !== 't' || !externalId || !companyId) return Promise.reject(new UnauthorizedError('bad'));
    return Promise.resolve({ externalId, companyId, email: 'x@y.test' });
  },
  resolveAccess: () => Promise.resolve({ roles: [], permissions: [] }),
  syncUser: () => Promise.resolve(),
};

const resolveMembership: MembershipResolver = (i) =>
  Promise.resolve(
    i.externalId === 'hr' && i.companyId === 'A'
      ? {
          userId: 'u1',
          membershipId: 'm1',
          employeeId: 'e1',
          roleKey: 'HR_ADMIN',
          permissions: ['employee:read:all', 'bogus:permission'],
        }
      : null,
  );

const app = createApp({ authProvider: provider, resolveMembership });

describe('GET /api/v1/me', () => {
  it('rejects a missing token with 401', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
  });

  it('rejects a verified identity with no membership with 403', async () => {
    const res = await request(app).get('/api/v1/me').set('authorization', 'Bearer t:hr:B');
    expect(res.status).toBe(403);
  });

  it('returns the membership-derived identity and drops unknown permissions', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('authorization', 'Bearer t:hr:A')
      .set('x-company-id', 'B'); // ignored: company comes only from the verified token
    expect(res.status).toBe(200);
    const body = meResponseSchema.parse(res.body);
    expect(body.data).toMatchObject({
      userId: 'u1',
      employeeId: 'e1',
      companyId: 'A',
      roles: ['HR_ADMIN'],
      permissions: ['employee:read:all'],
    });
  });
});
