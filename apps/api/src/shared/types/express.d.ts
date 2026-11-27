import type { AuthenticatedUser, VerifiedIdentity } from '../../integrations/central-auth/types';

declare global {
  namespace Express {
    interface Request {
      /** Verified token claims. Set by `authenticate`. Not yet authorised for any company. */
      identity?: VerifiedIdentity;
      /** How `identity` was proven. Cookie-authenticated requests are CSRF-protected; bearer ones are not. */
      authMethod?: 'session' | 'bearer';
      /**
       * CSRF hash of the session row `authenticate` validated for THIS request (session auth only). Lets
       * `requireCsrf` compare against the same row instead of reading it again. Server-side only; never serialised.
       */
      sessionCsrfHash?: string;
      /** Authorised caller. Set by `resolveTenant` after a validated ACTIVE membership lookup. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
