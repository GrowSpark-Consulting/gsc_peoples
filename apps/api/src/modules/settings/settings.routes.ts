/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows (database/tenant/tenant-db.ts) */
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { auditLogQuerySchema, type AuditLogQuery } from '@gsc/contracts';
import type { Prisma, PrismaClient } from '../../database/generated/client';
import type { TenantRunner } from '../../database/tenant';
import { requireRole } from '../../middleware/authorization/authorize';
import { validate } from '../../middleware/validation/validate';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { recordAudit } from '../audit/audit';
import { parseDateOnly, zonedDayStart } from '../attendance/attendance.rules';
import type { InvitationService } from '../auth/invitations';

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
  // Only web addresses: a `javascript:` or `data:` URL must never be stored for later rendering.
  logoUrl: z.string().url().max(2000).regex(/^https?:\/\//i, 'Use an http or https address').nullable().optional(),
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

/** Serialises changes that could remove the last Super Admin: two concurrent requests cannot both pass the count. */
async function lockSuperAdmins(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'super-admins:' + companyId}, 0))`;
}

const activeSuperAdmins = (tx: Prisma.TransactionClient, companyId: string) =>
  tx.companyMembership.count({ where: { companyId, status: 'ACTIVE', role: { key: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' } } });

export function createSettingsRouter(prisma: PrismaClient, tenantRunner: TenantRunner, invitations: InvitationService): Router {
  const router = Router();
  // Authorization policy (PRD AUTH-004/005/006, SET-001/002/004, section 5, W4). Not a router-wide Super Admin gate:
  //  - Super Admin only: changing company settings, role changes, audit log.
  //  - Super Admin or HR Admin: view company settings, list accounts, invite / resend, activate / deactivate, with
  //    the HR limits enforced inside the handlers: HR only invites, resends for and activates/deactivates Manager
  //    and Employee accounts. Anything touching an HR Admin or Super Admin account is Super Admin only.
  const superAdminOnly = requireRole('SUPER_ADMIN');
  const superAdminOrHr = requireRole('SUPER_ADMIN', 'HR_ADMIN');
  const isSuperAdmin = (req: Parameters<RequestHandler>[0]) => Boolean(req.user?.roles.includes('SUPER_ADMIN'));
  const HR_MAY_MANAGE = new Set(['MANAGER', 'EMPLOYEE']);
  const actor = (req: Parameters<RequestHandler>[0]) => ({ companyId: req.user!.companyId, actorUserId: req.user!.userId, actorIsSuperAdmin: isSuperAdmin(req) });
  // Path-scoped gates (kept out of the route signatures so Express keeps typing req.params). The role
  // route is gated first, so HR is refused there even though it may use the rest of /users.
  router.use(superAdminOrHr); // default floor: any settings route added later is closed to Managers and Employees
  router.use('/audit-logs', superAdminOnly);
  router.use('/users/:membershipId/role', superAdminOnly);

  router.get('/company', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    res.json({ data: company });
  });

  router.patch('/company', superAdminOnly, async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid company settings', parsed.error.flatten());
    const companyId = req.user.companyId;
    const company = await tenantRunner({ companyId }, async (db) => {
      const before = await db.company.findFirst({ where: { id: companyId } });
      const after = await db.company.update({ where: { id: companyId }, data: parsed.data });
      await recordAudit(db, { actorId: req.user!.userId, action: 'UPDATED', entity: 'company', entityId: companyId, oldValue: before, newValue: after });
      return after;
    });
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
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid invitation fields', parsed.error.flatten());
    res.status(201).json({ data: await invitations.issue({ ...actor(req), ...parsed.data }) });
  });

  router.post('/users/:membershipId/invitations/resend', async (req, res) => {
    res.json({ data: await invitations.resend({ ...actor(req), membershipId: String(req.params.membershipId) }) });
  });

  // SET-004: read-only, filterable by user, record and date. Dates are calendar days in the company's time zone.
  router.get('/audit-logs', validate({ query: auditLogQuerySchema }), async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const q = req.query as unknown as AuditLogQuery;
    const companyId = req.user.companyId;
    const result = await tenantRunner({ companyId }, async (db) => {
      const company = await db.company.findFirst({ select: { timezone: true } });
      const createdAt: { gte?: Date; lt?: Date } = {};
      if (q.from) createdAt.gte = zonedDayStart(parseDateOnly(q.from), company?.timezone);
      if (q.to) createdAt.lt = zonedDayStart(new Date(parseDateOnly(q.to).getTime() + 86_400_000), company?.timezone);
      const where = {
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
      };
      const [rows, total] = await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { actor: { select: { name: true, email: true } } },
        }),
        db.auditLog.count({ where }),
      ]);
      return { rows, total };
    });
    res.json({
      data: (result.rows as Array<Record<string, any>>).map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorName: r.actor?.name ?? r.actor?.email ?? null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        oldValue: r.oldValue ?? null,
        newValue: r.newValue ?? null,
        createdAt: r.createdAt,
      })),
      page: { page: q.page, pageSize: q.pageSize, total: result.total },
    });
  });

  router.patch('/users/:membershipId/status', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid account status', parsed.error.flatten());
    const companyId = req.user.companyId;
    const { status } = parsed.data;
    const membershipId = String(req.params.membershipId);

    await prisma.$transaction(async (tx) => {
      await lockSuperAdmins(tx, companyId);
      const membership = await tx.companyMembership.findFirst({
        where: { id: membershipId, companyId },
        include: { user: true, role: true, employee: { select: { status: true } } },
      });
      if (!membership) throw new NotFoundError('Account not found');
      // The target's role is read from the database for this company, never from the request. HR may only
      // activate/deactivate ordinary (Manager, Employee) accounts: not HR Admins (itself included) and not
      // Super Admins.
      if (!isSuperAdmin(req) && !HR_MAY_MANAGE.has(membership.role.key)) {
        throw new ForbiddenError('Only a Super Admin can change an HR Admin or Super Admin account');
      }
      if (status === 'ACTIVE') {
        if (membership.status === 'INVITED') throw new ConflictError('This account has not accepted its invitation yet. Resend the invitation instead.');
        // W10: the login of an offboarded employee is re-enabled only after the employee is reactivated.
        if (membership.employee && (membership.employee.status === 'INACTIVE' || membership.employee.status === 'TERMINATED')) {
          throw new ConflictError('Reactivate the employee record before enabling this login');
        }
      }
      if (status === 'DISABLED' && membership.role.key === 'SUPER_ADMIN' && membership.status === 'ACTIVE' && (await activeSuperAdmins(tx, companyId)) <= 1) {
        throw new ForbiddenError('The last Super Admin cannot be disabled');
      }
      await tx.user.update({ where: { id: membership.userId }, data: { status } });
      await tx.companyMembership.update({ where: { id: membership.id }, data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' } });
      if (status === 'DISABLED') {
        await tx.userSession.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.invitationToken.updateMany({ where: { membershipId: membership.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({
        data: { companyId, actorId: req.user!.userId, action: status === 'ACTIVE' ? 'ACTIVATED' : 'DISABLED', entity: 'user', entityId: membership.userId, oldValue: { status: membership.user.status }, newValue: { status } },
      });
    });
    res.json({ data: { membershipId, status } });
  });

  router.patch('/users/:membershipId/role', async (req, res) => {
    if (!req.user) throw new ForbiddenError();
    const parsed = z.object({ roleKey: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']) }).safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid role', parsed.error.flatten());
    const companyId = req.user.companyId;
    const membershipId = String(req.params.membershipId);

    const roleKey = await prisma.$transaction(async (tx) => {
      await lockSuperAdmins(tx, companyId);
      const membership = await tx.companyMembership.findFirst({ where: { id: membershipId, companyId }, include: { role: true } });
      if (!membership) throw new NotFoundError('Account not found');
      if (membership.role.key === 'SUPER_ADMIN' && parsed.data.roleKey !== 'SUPER_ADMIN' && membership.status === 'ACTIVE' && (await activeSuperAdmins(tx, companyId)) <= 1) {
        throw new ForbiddenError('The last Super Admin cannot be demoted');
      }
      const role = await tx.role.findFirst({ where: { companyId, key: parsed.data.roleKey } });
      if (!role) throw new ConflictError('Role is not configured for this company');
      await tx.companyMembership.update({ where: { id: membership.id }, data: { roleId: role.id } });
      await tx.userSession.updateMany({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { companyId, actorId: req.user!.userId, action: 'ROLE_CHANGED', entity: 'user', entityId: membership.userId, oldValue: { roleKey: membership.role.key }, newValue: { roleKey: role.key } },
      });
      return role.key;
    });
    res.json({ data: { membershipId, roleKey } });
  });

  return router;
}
