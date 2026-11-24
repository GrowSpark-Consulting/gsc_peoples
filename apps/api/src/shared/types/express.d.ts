import type { AuthenticatedUser, VerifiedIdentity } from '../../integrations/central-auth/types';

declare global {
  namespace Express {
    interface Request {
      /** Verified token claims. Set by `authenticate`. Not yet authorised for any company. */
      identity?: VerifiedIdentity;
      /** How `identity` was proven. Cookie-authenticated requests are CSRF-protected; bearer ones are not. */
      authMethod?: 'session' | 'bearer';
      /** Authorised caller. Set by `resolveTenant` after a validated ACTIVE membership lookup. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
