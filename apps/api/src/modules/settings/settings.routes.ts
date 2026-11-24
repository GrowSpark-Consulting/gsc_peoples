import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { normalizeEmail } from '@gsc/shared';
import type { PrismaClient } from '../../database/generated/client';
import { requireRole } from '../../middleware/authorization/authorize';
import { ConflictError, ForbiddenError, ValidationError } from '../../shared/errors';
import { secureToken, tokenHash } from '../auth/password';

const validIanaTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  logoUrl: z.string().url().nullable().optional(),
  timezone: z.string().trim().min(1).max(100).refine(validIanaTimezone, 'Must be a valid IANA timezone'),
  workingDays: z.array(z.int().min(1).max(7)).min(1).max(7).refine((days) => new Set(days).size === days.length),
  workStartTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  workEndTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
}).refine((v) => v.workStartTime < v.workEndTime, { message: 'Work start time must be before end time', path: ['workEndTime'] });

const inviteSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200).optional(),
  employeeId: z.string().uuid().optional(),
  roleKey: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']),
});

async function appendAudit(prisma: PrismaClient, req: Parameters<RequestHandler>[0], action: string, entity: string, entityId: string, oldValue: unknown, newValue: unknown) {
  if (!req.user) return;
  await prisma.auditLog.create({
    data: { companyId: req.user.companyId, actorId: req.user.userId, action, entity, entityId, oldValue: oldValue as object, newValue: newValue as object },
  });
}

export function createSettingsRouter(prisma: PrismaClient): Router {
  const router = Router();
  // Authorization policy (PRD AUTH-004/005/006, SET-001/002/004, W4). Not a router-wide Super Admin gate:
  //  - Super Admin only: company profile, role changes, audit log.
  //  - Super Admin or HR Admin: list accounts, invite / resend, activate / deactivate, with the HR limits
  //    enforced inside the handlers: HR only invites, resends for and activates/deactivates Manager and
  //    Employee accounts. Anything touching an HR Admin or Super Admin account is Super Admin only.
  const superAdminOnly = requireRole('SUPER_ADMIN');
  const superAdminOrHr = requireRole('SUPER_ADMIN', 'HR_ADMIN');
  const isSuperAdmin = (req: Parameters<RequestHandler>[0]) => Boolean(req.user?.roles.includes('SUPER_ADMIN'));
  const HR_MAY_INVITE = new Set(['MANAGER', 'EMPLOYEE']);
  // Path-scoped gates (kept out of the route signatures so Express keeps typing req.params). The role
  // route is gated first, so HR is refused there even though it may use the rest of /users.
  router.use(superAdminOrHr); // default floor: any settings route added later is closed to Managers and Employees
  router.use('/company', superAdminOnly);
  router.use('/audit-logs', superAdminOnly);
  router.use('/users/:membershipId/role', superAdminOnly);
  router.use('/users', superAdminOrHr);

  router.get('/company', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    res.json({ data: company });
  });

  router.patch('/company', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid company settings', parsed.error.flatten());
    const before = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    const company = await prisma.company.update({ where: { id: req.user.companyId }, data: parsed.data });
    await appendAudit(prisma, req, 'UPDATED', 'company', company.id, before, company);
    res.json({ data: company });
  });

  router.get('/users', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const memberships = await prisma.companyMembership.findMany({
      where: { companyId: req.user.companyId },
      include: {
        user: { select: { id: true, email: true, name: true, status: true, lastLoginAt: true } },
        role: { select: { key: true, name: true } },
        employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
        invitations: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: memberships.map((m) => {
      const invitation = m.invitations[0];
      const invitationStatus = m.status === 'ACTIVE'
        ? 'ACTIVE'
        : invitation?.usedAt
          ? 'ACCEPTED'
          : invitation?.revokedAt
            ? 'RESCINDED'
            : invitation && invitation.expiresAt > new Date()
              ? 'PENDING'
              : 'EXPIRED';
      return {
        id: m.id,
        userId: m.userId,
        employeeId: m.employeeId,
        employee: m.employee,
        status: m.status,
        roleKey: m.role.key,
        roleName: m.role.name,
        email: m.user.email,
        name: m.user.name,
        accountStatus: m.user.status,
        lastLoginAt: m.user.lastLoginAt,
        invitationStatus,
        invitationExpiresAt: invitation?.expiresAt ?? null,
      };
    }) });
  });

  router.post('/users/invite', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid invitation fields', parsed.error.flatten());
    const email = normalizeEmail(parsed.data.email);
    const role = await prisma.role.findFirst({ where: { companyId: req.user.companyId, key: parsed.data.roleKey } });
    if (!role) throw new ConflictError('Role is not configured for this company');
    if (!isSuperAdmin(req) && !HR_MAY_INVITE.has(parsed.data.roleKey)) {
      throw new ForbiddenError('Only a Super Admin can invite HR Admin or Super Admin accounts');
    }

    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({ data: { externalId: `local:${email}`, email, name: parsed.data.name ?? null } });
      }
      const existing = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: req.user!.companyId, userId: user.id } } });
      if (existing) throw new ConflictError('This user already belongs to the company');
      if (parsed.data.employeeId) {
        const employee = await tx.employee.findFirst({
          where: { id: parsed.data.employeeId, companyId: req.user!.companyId },
          select: { id: true },
        });
        if (!employee) throw new ConflictError('Employee record not found in this company');
        const linked = await tx.companyMembership.findFirst({
          where: { companyId: req.user!.companyId, employeeId: parsed.data.employeeId, userId: { not: user.id } },
          select: { id: true },
        });
        if (linked) throw new ConflictError('Employee is already linked to a login account');
      }
      const membership = await tx.companyMembership.create({
        data: {
          companyId: req.user!.companyId,
          userId: user.id,
          roleId: role.id,
          employeeId: parsed.data.employeeId ?? null,
          status: 'INVITED',
          invitedAt: new Date(),
        },
      });
      const token = secureToken();
      await tx.invitationToken.create({
        data: { companyId: req.user!.companyId, userId: user.id, membershipId: membership.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });
      await tx.auditLog.create({
        data: { companyId: req.user!.companyId, actorId: req.user!.userId, action: 'INVITED', entity: 'user', entityId: user.id, newValue: { roleKey: role.key, membershipId: membership.id } },
      });
      return { user, membership, token };
    });
    res.status(201).json({ data: { userId: result.user.id, membershipId: result.membership.id, expiresInDays: 7, invitationToken: result.token } });
  });

  router.post('/users/:membershipId/invitations/resend', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const membership = await prisma.companyMembership.findFirst({
      where: { id: req.params.membershipId, companyId: req.user.companyId },
      include: { user: true, role: true },
    });
    if (!membership) throw new ConflictError('Membership not found');
    if (!isSuperAdmin(req) && !HR_MAY_INVITE.has(membership.role.key)) {
      throw new ForbiddenError('Only a Super Admin can manage HR Admin or Super Admin invitations');
    }
    if (membership.status === 'ACTIVE') throw new ConflictError('Only invited accounts can be invited');

    const result = await prisma.$transaction(async (tx) => {
      await tx.invitationToken.updateMany({
        where: { membershipId: membership.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = secureToken();
      await tx.invitationToken.create({
        data: {
          companyId: req.user!.companyId,
          userId: membership.userId,
          membershipId: membership.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: req.user!.companyId,
          actorId: req.user!.userId,
          action: 'INVITATION_RESENT',
          entity: 'user',
          entityId: membership.userId,
          newValue: { membershipId: membership.id, expiresInDays: 7 },
        },
      });
      return token;
    });
    res.json({ data: { membershipId: membership.id, expiresInDays: 7, invitationToken: result } });
  });

  router.get('/audit-logs', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const logs = await prisma.auditLog.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ data: logs });
  });

  router.patch('/users/:membershipId/status', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid account status', parsed.error.flatten());
    const membership = await prisma.companyMembership.findFirst({
      where: { id: req.params.membershipId, companyId: req.user.companyId },
      include: { user: true, role: true },
    });
    if (!membership) throw new ConflictError('Membership not found');
    // The target's role is read from the database for this company, never from the request. HR may only
    // activate/deactivate ordinary (Manager, Employee) accounts: not HR Admins (itself included) and not
    // Super Admins.
    if (!isSuperAdmin(req) && !HR_MAY_INVITE.has(membership.role.key)) {
      throw new ForbiddenError('Only a Super Admin can change an HR Admin or Super Admin account');
    }

    if (membership.role.key === 'SUPER_ADMIN' && parsed.data.status === 'DISABLED') {
      const superAdmins = await prisma.companyMembership.count({
        where: { companyId: req.user.companyId, status: 'ACTIVE', role: { key: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' } },
      });
      if (superAdmins <= 1) throw new ForbiddenError('The last Super Admin cannot be disabled');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: membership.userId }, data: { status: parsed.data.status } });
      await tx.companyMembership.update({ where: { id: membership.id }, data: { status: parsed.data.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' } });
      if (parsed.data.status === 'DISABLED') {
        await tx.userSession.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({
        data: { companyId: req.user!.companyId, actorId: req.user!.userId, action: parsed.data.status === 'ACTIVE' ? 'ACTIVATED' : 'DISABLED', entity: 'user', entityId: membership.userId, oldValue: { status: membership.user.status }, newValue: { status: parsed.data.status } },
      });
    });
    res.json({ data: { membershipId: membership.id, status: parsed.data.status } });
  });

  router.patch('/users/:membershipId/role', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = z.object({ roleKey: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid role', parsed.error.flatten());
    const membership = await prisma.companyMembership.findFirst({
      where: { id: req.params.membershipId, companyId: req.user.companyId }, include: { role: true, user: true },
    });
    if (!membership) throw new ConflictError('Membership not found');

    if (membership.role.key === 'SUPER_ADMIN' && parsed.data.roleKey !== 'SUPER_ADMIN') {
      const superAdmins = await prisma.companyMembership.count({
        where: { companyId: req.user.companyId, status: 'ACTIVE', role: { key: 'SUPER_ADMIN' } },
      });
      if (superAdmins <= 1) throw new ForbiddenError('The last Super Admin cannot be demoted');
    }

    const role = await prisma.role.findFirst({ where: { companyId: req.user.companyId, key: parsed.data.roleKey } });
    if (!role) throw new ConflictError('Role is not configured for this company');
    await prisma.$transaction(async (tx) => {
      await tx.companyMembership.update({ where: { id: membership.id }, data: { roleId: role.id } });
      await tx.userSession.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { companyId: req.user!.companyId, actorId: req.user!.userId, action: 'ROLE_CHANGED', entity: 'user', entityId: membership.userId, oldValue: { roleKey: membership.role.key }, newValue: { roleKey: role.key } },
      });
    });
    res.json({ data: { membershipId: membership.id, roleKey: role.key } });
  });

  return router;
}
