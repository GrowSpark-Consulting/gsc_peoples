import { env, type Env } from '../../config/env';
import { DevAuthProvider, DisabledAuthProvider } from './dev.provider';
import { SsoProvider } from './sso.provider';
import type { CentralAuthProvider } from './types';

export type { AuthenticatedUser, CentralAuthProvider, VerifiedIdentity } from './types';

type AuthConfig = Pick<Env,
  | 'AUTH_MODE'
  | 'NODE_ENV'
  | 'DEV_AUTH_ENABLED'
  | 'DEV_AUTH_COMPANY_ID'
  | 'CENTRAL_AUTH_JWKS_URL'
  | 'CENTRAL_AUTH_ISSUER'
  | 'CENTRAL_AUTH_AUDIENCE'>;

export function createAuthProvider(config: AuthConfig = env): CentralAuthProvider {
  if (config.AUTH_MODE === 'sso') {
    if (!config.CENTRAL_AUTH_JWKS_URL || !config.CENTRAL_AUTH_ISSUER || !config.CENTRAL_AUTH_AUDIENCE) {
      throw new Error('Central Authentication requires JWKS URL, issuer and audience');
    }
    return new SsoProvider({
      jwksUrl: config.CENTRAL_AUTH_JWKS_URL,
      issuer: config.CENTRAL_AUTH_ISSUER,
      audience: config.CENTRAL_AUTH_AUDIENCE,
    });
  }
  if (config.AUTH_MODE === 'session') {
    // Cookie sessions only (verified by SessionAuthProvider in app.ts). Bearer tokens are rejected.
    return new DisabledAuthProvider();
  }
  if (config.NODE_ENV === 'production') {
    throw new Error('Development authentication adapter must never run in production');
  }
  // Development auth needs BOTH NODE_ENV=development and an explicit flag; anything else fails closed.
  if (config.NODE_ENV === 'development' && config.DEV_AUTH_ENABLED) {
    return new DevAuthProvider(config.DEV_AUTH_COMPANY_ID);
  }
  return new DisabledAuthProvider();
}
