import type { RequestHandler } from 'express';
import type { PrismaClient } from '../../database/generated/client';
import { cachedTokenHashAsync } from '../../modules/auth/password';
import { ForbiddenError } from '../../shared/errors';
import { decodeCookieValue } from './cookie-value';

export function requireCsrf(prisma?: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    // Only requests actually authenticated by a bearer token are exempt. An Authorization header on a
    // cookie-authenticated request must not switch CSRF off (browsers send the cookie automatically).
    if (req.authMethod === 'bearer') return next();

    const csrfHeader = req.header('x-csrf-token');
    const cookies = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim()) ?? [];
    const sessionCookie = cookies.find((part) => part.startsWith('gsc_session='));
    const csrfCookie = cookies.find((part) => part.startsWith('gsc_csrf='));
    if (!csrfHeader || !sessionCookie || !csrfCookie) throw new ForbiddenError('CSRF validation failed');

    const csrfValue = decodeCookieValue(csrfCookie.slice('gsc_csrf='.length));
    const sessionValue = decodeCookieValue(sessionCookie.slice('gsc_session='.length));
    if (!prisma || csrfHeader !== csrfValue) throw new ForbiddenError('CSRF validation failed');

    // `authenticate` already validated this exact session cookie (revocation, expiry, idle timeout, account status)
    // moments ago in the same request and kept its row's CSRF hash: compare against that row instead of reading it again.
    if (req.authMethod === 'session' && req.sessionCsrfHash) {
      if (req.sessionCsrfHash !== (await cachedTokenHashAsync(csrfValue))) throw new ForbiddenError('CSRF validation failed');
      return next();
    }

    const [sessionHash, csrfHash] = await Promise.all([cachedTokenHashAsync(sessionValue), cachedTokenHashAsync(csrfValue)]);
    const session = await prisma.userSession.findUnique({
      where: { tokenHash: sessionHash },
      select: { csrfHash: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()
      || session.csrfHash !== csrfHash) {
      throw new ForbiddenError('CSRF validation failed');
    }
    next();
  };
}
