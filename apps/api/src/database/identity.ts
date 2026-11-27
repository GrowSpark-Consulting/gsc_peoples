import { permissionsForRole } from '@gsc/contracts';
import { normalizeEmail } from '@gsc/shared';
import type { PrismaClient } from './generated/client';

/**
 * Identity store: the ONLY code allowed to touch the global `User` table. Fixed-purpose functions,
 * not a generic client. Email is normalised here, before the write; the CHECK constraint is the
 * backstop.
 */
export function createIdentityStore(prisma: PrismaClient) {
  return {
    /** First-login / sync: create or refresh the cached identity for a Central Authentication subject. */
    async upsertUser(input: { externalId: string; email: string; name?: string | null }) {
      const email = normalizeEmail(input.email);
      return prisma.user.upsert({
        where: { externalId: input.externalId },
        create: { externalId: input.externalId, email, name: input.name ?? null },
        update: { email, name: input.name ?? null, lastLoginAt: new Date() },
      });
    },

    /** "Which companies can I switch to": the caller's OWN memberships (userId is the authenticated user). */
    listMembershipsForUser(userId: string) {
      return prisma.companyMembership.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { id: true, companyId: true, roleId: true, employeeId: true },
      });
    },

    /**
     * Validates that the Central Authentication subject is an ACTIVE user with an ACTIVE
     * membership in `companyId`, and returns the role (and the code-defined permissions for that role) granted in THAT company.
     * Returns null when any link is missing, so callers fail closed. `companyId` must come from the
     * verified token claims, never from request input.
     */
    async resolveActiveMembership(input: { externalId: string; companyId: string }) {
      // One round trip (runs on every authenticated request): the ACTIVE membership of the ACTIVE user with this
      // external id. Same conditions as looking the user up first and the membership second.
      const membership = await prisma.companyMembership.findFirst({
        where: {
          companyId: input.companyId,
          status: 'ACTIVE',
          user: { externalId: input.externalId, status: 'ACTIVE' },
        },
        select: {
          id: true,
          userId: true,
          employeeId: true,
          role: { select: { key: true } },
        },
      });
      if (!membership) return null;

      return {
        userId: membership.userId,
        membershipId: membership.id,
        employeeId: membership.employeeId,
        roleKey: membership.role.key,
        // PRD SET-003: permissions are defined in code per role key. `role_permissions` rows are not read.
        permissions: permissionsForRole(membership.role.key),
      };
    },
  };
}
