import type { PrismaClient } from '../../database/generated/client';
import { UnauthorizedError } from '../../shared/errors';
import type { CentralAuthProvider, VerifiedIdentity } from '../central-auth/types';
import { cachedTokenHashAsync } from '../../modules/auth/password';

/** Sessions expire after this much inactivity. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/**
 * `lastActivityAt` is written at most once per this interval per session. Writing it on every request cost one
 * extra database round trip per API call; at an 8-hour idle timeout a one-minute resolution changes nothing a
 * user can notice (the stored timestamp may lag by up to a minute, so an idle session can end up to one minute
 * EARLIER than exactly 8h after its last request — never later).
 */
export const SESSION_ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export class SessionAuthProvider implements CentralAuthProvider {
  readonly kind = 'development' as const;

  constructor(private readonly prisma: PrismaClient) {}

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS);
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: await cachedTokenHashAsync(token) },
      include: { user: { select: { externalId: true, email: true, name: true, status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || session.lastActivityAt < idleCutoff) {
      throw new UnauthorizedError('Session expired');
    }
    if (session.user.status !== 'ACTIVE') throw new UnauthorizedError('Account disabled');

    if (now.getTime() - session.lastActivityAt.getTime() >= SESSION_ACTIVITY_WRITE_INTERVAL_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastActivityAt: now },
      });
    }

    return {
      externalId: session.user.externalId,
      companyId: session.companyId,
      email: session.user.email,
      ...(session.user.name ? { name: session.user.name } : {}),
      sessionCsrfHash: session.csrfHash,
    };
  }

  resolveAccess(): Promise<{ roles: string[]; permissions: string[] }> {
    return Promise.resolve({ roles: [], permissions: [] });
  }

  syncUser(): Promise<void> {
    return Promise.resolve();
  }
}
