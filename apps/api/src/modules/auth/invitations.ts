import { randomUUID } from 'node:crypto';
import type { RoleKey } from '@gsc/contracts';
import { normalizeEmail } from '@gsc/shared';
import type { PrismaClient } from '../../database/generated/client';
import { INVITATION_TTL_DAYS, invitationEmail, type Mailer } from '../../integrations/mail';
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/utils/logger';
import { secureToken, tokenHashAsync } from './password';

/**
 * Account invitation (PRD AUTH-004, W4), the one implementation behind both the employee record and the
 * user-accounts screen:
 *  - one login per employee; the login email is the employee's work email;
 *  - only a Super Admin invites HR Admin or Super Admin roles;
 *  - the link works once, for 7 days, and a resend voids the earlier one;
 *  - an email that already belongs to another account is rejected;
 *  - the link is EMAILED. Outside production the token is also returned so local development and tests can
 *    complete the flow without a mail server; in production it never appears in a response or a log.
 */
export interface InvitationConfig {
  mailer: Mailer;
  webAppUrl?: string;
  /** Return the raw token to the caller. Never true in production. */
  exposeToken: boolean;
}

export interface InvitationRequest {
  companyId: string;
  actorUserId: string;
  actorIsSuperAdmin: boolean;
  /** Invite the person on this employee record. */
  employeeId?: string;
  /** Required without an employee record; with one it must match the work email. */
  email?: string;
  name?: string;
  /** Default Employee. Ignored on a resend: an invited account keeps its role. */
  roleKey?: RoleKey;
}

export interface InvitationResult {
  status: 'INVITED' | 'RESENT';
  userId: string;
  membershipId: string;
  expiresAt: string;
  expiresInDays: number;
  invitationToken?: string;
}

const LOW_ROLES: ReadonlySet<string> = new Set(['MANAGER', 'EMPLOYEE']);
const TTL_MS = INVITATION_TTL_DAYS * 86_400_000;

export function createInvitationService(prisma: PrismaClient, config: InvitationConfig) {
  function assertDeliverable() {
    // Without an email channel an invitation could never reach the person: fail before writing anything.
    if (!config.exposeToken && config.mailer.driver === 'disabled') {
      throw new ServiceUnavailableError('Email delivery is not configured, so invitations cannot be sent');
    }
  }

  async function deliver(to: string, companyName: string, token: string) {
    if (config.mailer.driver === 'disabled') return; // only reachable outside production (see assertDeliverable)
    try {
      await config.mailer.send(invitationEmail({ to, companyName, token, webAppUrl: config.webAppUrl ?? 'http://localhost:3000' }));
    } catch (err) {
      logger.error({ err }, 'invitation email failed');
      throw new ServiceUnavailableError('The invitation was saved but the email could not be sent. Resend it once email delivery works.');
    }
  }

  async function issue(request: InvitationRequest): Promise<InvitationResult> {
    assertDeliverable();
    const outcome = await prisma.$transaction(async (tx) => {
      const { companyId } = request;
      const employee = request.employeeId
        ? await tx.employee.findFirst({
            where: { id: request.employeeId, companyId },
            select: { id: true, firstName: true, lastName: true, workEmail: true, status: true },
          })
        : null;
      if (request.employeeId && !employee) throw new NotFoundError('Employee not found');
      if (employee && (employee.status === 'INACTIVE' || employee.status === 'TERMINATED')) {
        throw new ValidationError('An inactive employee cannot be invited');
      }
      if (employee && !employee.workEmail) throw new ValidationError('Employee must have a work email before inviting');
      const requested = request.email ? normalizeEmail(request.email) : undefined;
      if (employee && requested && requested !== normalizeEmail(employee.workEmail!)) {
        throw new ValidationError('The login email must be the employee work email');
      }
      const email = employee ? normalizeEmail(employee.workEmail!) : requested;
      if (!email) throw new ValidationError('An email address is required');

      let membership = employee
        ? await tx.companyMembership.findFirst({ where: { companyId, employeeId: employee.id }, include: { role: true, user: true } })
        : null;
      const resend = membership !== null;

      if (membership) {
        if (membership.status === 'ACTIVE') throw new ConflictError('Employee already has an active login account');
        if (membership.status !== 'INVITED') throw new ConflictError('This login was deactivated. Activate it from the user accounts list instead.');
        if (membership.user.email !== email) throw new ConflictError('The invited account uses a different email. Contact a Super Admin.');
        if (!request.actorIsSuperAdmin && !LOW_ROLES.has(membership.role.key)) {
          throw new ForbiddenError('Only a Super Admin can manage HR Admin or Super Admin invitations');
        }
      } else {
        const roleKey = request.roleKey ?? 'EMPLOYEE';
        if (!request.actorIsSuperAdmin && !LOW_ROLES.has(roleKey)) {
          throw new ForbiddenError('Only a Super Admin can invite HR Admin or Super Admin accounts');
        }
        const role = await tx.role.findFirst({ where: { companyId, key: roleKey } });
        if (!role) throw new ConflictError('Role is not configured for this company');

        let user = await tx.user.findUnique({ where: { email }, include: { memberships: { select: { id: true } } } });
        // An address that already signs in, or already belongs somewhere, is never silently re-pointed: accepting
        // an invitation sets the password, so reusing an account would hand it to whoever gets the new link.
        if (user && (user.passwordHash || user.memberships.length > 0)) throw new ConflictError('This email is already used by another account');
        if (!user) {
          const name = request.name ?? (employee ? `${employee.firstName} ${employee.lastName}`.trim() : null);
          user = await tx.user.create({ data: { externalId: `local:${randomUUID()}`, email, name }, include: { memberships: { select: { id: true } } } });
        }
        const created = await tx.companyMembership.create({
          data: { companyId, userId: user.id, roleId: role.id, employeeId: employee?.id ?? null, status: 'INVITED', invitedAt: new Date() },
        });
        membership = { ...created, role, user };
      }

      await tx.invitationToken.updateMany({ where: { membershipId: membership.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const token = secureToken();
      const expiresAt = new Date(Date.now() + TTL_MS);
      await tx.invitationToken.create({
        data: { companyId, userId: membership.userId, membershipId: membership.id, tokenHash: await tokenHashAsync(token), expiresAt },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          actorId: request.actorUserId,
          action: resend ? 'INVITATION_RESENT' : 'INVITED',
          entity: 'user',
          entityId: membership.userId,
          newValue: { roleKey: membership.role.key, membershipId: membership.id, expiresInDays: INVITATION_TTL_DAYS },
        },
      });
      if (employee) {
        await tx.employeeAuditLog.create({
          data: {
            companyId,
            employeeId: employee.id,
            actorUserId: request.actorUserId,
            action: resend ? 'INVITATION_RESENT' : 'INVITATION_SENT',
            changes: { roleKey: { from: null, to: membership.role.key } },
          },
        });
      }
      const company = await tx.company.findFirst({ where: { id: companyId }, select: { name: true } });
      return {
        token,
        email,
        companyName: company?.name ?? 'your company',
        result: {
          status: resend ? ('RESENT' as const) : ('INVITED' as const),
          userId: membership.userId,
          membershipId: membership.id,
          expiresAt: expiresAt.toISOString(),
          expiresInDays: INVITATION_TTL_DAYS,
        },
      };
    });

    await deliver(outcome.email, outcome.companyName, outcome.token);
    return { ...outcome.result, ...(config.exposeToken ? { invitationToken: outcome.token } : {}) };
  }

  /** Resend for an account on the user list, which may have no employee record. */
  async function resend(input: { companyId: string; actorUserId: string; actorIsSuperAdmin: boolean; membershipId: string }): Promise<InvitationResult> {
    const membership = await prisma.companyMembership.findFirst({
      where: { id: input.membershipId, companyId: input.companyId },
      include: { user: true, role: true },
    });
    if (!membership) throw new NotFoundError('Account not found');
    if (!input.actorIsSuperAdmin && !LOW_ROLES.has(membership.role.key)) {
      throw new ForbiddenError('Only a Super Admin can manage HR Admin or Super Admin invitations');
    }
    if (membership.status !== 'INVITED') throw new ConflictError('Only an invited account can be invited again');
    if (membership.employeeId) {
      return issue({ companyId: input.companyId, actorUserId: input.actorUserId, actorIsSuperAdmin: input.actorIsSuperAdmin, employeeId: membership.employeeId });
    }

    assertDeliverable();
    const token = secureToken();
    const invitationHash = await tokenHashAsync(token);
    const expiresAt = new Date(Date.now() + TTL_MS);
    const companyName = await prisma.$transaction(async (tx) => {
      await tx.invitationToken.updateMany({ where: { membershipId: membership.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.invitationToken.create({
        data: { companyId: input.companyId, userId: membership.userId, membershipId: membership.id, tokenHash: invitationHash, expiresAt },
      });
      await tx.auditLog.create({
        data: {
          companyId: input.companyId,
          actorId: input.actorUserId,
          action: 'INVITATION_RESENT',
          entity: 'user',
          entityId: membership.userId,
          newValue: { membershipId: membership.id, expiresInDays: INVITATION_TTL_DAYS },
        },
      });
      const company = await tx.company.findFirst({ where: { id: input.companyId }, select: { name: true } });
      return company?.name ?? 'your company';
    });
    await deliver(membership.user.email, companyName, token);
    return {
      status: 'RESENT',
      userId: membership.userId,
      membershipId: membership.id,
      expiresAt: expiresAt.toISOString(),
      expiresInDays: INVITATION_TTL_DAYS,
      ...(config.exposeToken ? { invitationToken: token } : {}),
    };
  }

  return { issue, resend };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
