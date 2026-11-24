import type { RequestHandler } from 'express';
import type { CentralAuthProvider } from '../../integrations/central-auth';
import { UnauthorizedError } from '../../shared/errors';

/**
 * Verifies the bearer token with the configured Central Auth provider and sets `req.identity`.
 * This proves who the caller is; it does NOT grant access to any company. Feature routes must also
 * run `resolveTenant`, which validates an ACTIVE membership and sets `req.user`.
 */
export function authenticate(provider: CentralAuthProvider, sessionProvider?: CentralAuthProvider): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;

    const cookieHeader = req.headers.cookie;
    const sessionCookie = cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('gsc_session='));
    const sessionToken = sessionCookie ? decodeURIComponent(sessionCookie.slice('gsc_session='.length)) : undefined;

    // A session cookie is only usable when a session provider is configured; otherwise it is ignored
    // and the caller must present a bearer token. Never call a provider with an undefined token.
    let verifiedBy: CentralAuthProvider;
    if (sessionToken && sessionProvider) {
      req.identity = await sessionProvider.verifyToken(sessionToken);
      req.authMethod = 'session';
      verifiedBy = sessionProvider;
    } else if (bearerToken) {
      req.identity = await provider.verifyToken(bearerToken);
      req.authMethod = 'bearer';
      verifiedBy = provider;
    } else {
      throw new UnauthorizedError('Missing bearer token or session');
    }
    await verifiedBy.syncUser(req.identity);
    next();
  };
}
