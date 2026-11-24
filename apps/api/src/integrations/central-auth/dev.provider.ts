import { UnauthorizedError } from '../../shared/errors';
import type { CentralAuthProvider, VerifiedIdentity } from './types';

/**
 * The fixed identities created by `pnpm db:provision:local`. Kept server-side on purpose: this list used
 * to live in the shared contracts package, which the web app bundles, and it leaked persona ids into
 * production client bundles.
 */
const DEV_EXTERNAL_IDS: readonly string[] = ['dev-super-admin', 'dev-hr-admin', 'dev-manager', 'dev-employee'];

/**
 * LOCAL DEVELOPMENT ONLY - not an authentication system and not SSO.
 * Accepts tokens of the exact form `dev:<externalId>` where externalId is one of the provisioned
 * development identities. No cryptography. Roles, permissions and company are never read from the
 * token: the company is fixed by server configuration and access comes from the database membership.
 * The factory only builds this when NODE_ENV=development AND DEV_AUTH_ENABLED=true.
 */
export class DevAuthProvider implements CentralAuthProvider {
  readonly kind = 'development' as const;

  constructor(private readonly companyId: string) {}

  verifyToken(token: string): Promise<VerifiedIdentity> {
    const parts = token.split(':');
    const [prefix, externalId] = parts;
    if (parts.length !== 2 || prefix !== 'dev' || !externalId || !DEV_EXTERNAL_IDS.includes(externalId)) {
      return Promise.reject(new UnauthorizedError('Invalid development token'));
    }
    return Promise.resolve({ externalId, companyId: this.companyId });
  }

  resolveAccess() {
    return Promise.resolve({ roles: [] as string[], permissions: [] as string[] });
  }

  syncUser(): Promise<void> {
    return Promise.resolve();
  }
}

/** Fails closed: used when development auth is not explicitly enabled. Accepts no token. */
export class DisabledAuthProvider implements CentralAuthProvider {
  readonly kind = 'development' as const;

  verifyToken(): Promise<never> {
    return Promise.reject(new UnauthorizedError('Authentication is not enabled'));
  }

  resolveAccess() {
    return Promise.resolve({ roles: [] as string[], permissions: [] as string[] });
  }

  syncUser(): Promise<void> {
    return Promise.resolve();
  }
}
