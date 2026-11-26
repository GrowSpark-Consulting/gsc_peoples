import type { PrismaClient } from '../../database/generated/client';
import { UnauthorizedError } from '../../shared/errors';
import type { CentralAuthProvider, VerifiedIdentity } from '../central-auth/types';
import { tokenHashAsync } from '../../modules/auth/password';

export class SessionAuthProvider implements CentralAuthProvider {
  readonly kind = 'development' as const;

  constructor(private readonly prisma: PrismaClient) {}

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - 8 * 60 * 60 * 1000);
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: await tokenHashAsync(token) },
      include: { user: { select: { externalId: true, email: true, name: true, status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || session.lastActivityAt < idleCutoff) {
      throw new UnauthorizedError('Session expired');
    }
    if (session.user.status !== 'ACTIVE') throw new UnauthorizedError('Account disabled');

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastActivityAt: now },
    });

    return {
      externalId: session.user.externalId,
      companyId: session.companyId,
      email: session.user.email,
      ...(session.user.name ? { name: session.user.name } : {}),
    };
  }

  resolveAccess(): Promise<{ roles: string[]; permissions: string[] }> {
    return Promise.resolve({ roles: [], permissions: [] });
  }

  syncUser(): Promise<void> {
    return Promise.resolve();
  }
}
