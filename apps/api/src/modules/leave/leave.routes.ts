import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, adjustLeaveBalanceSchema, createLeaveRequestSchema, createLeaveTypeSchema, leaveRequestDecisionSchema, leaveRequestListQuerySchema, updateLeaveTypeSchema } from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import type { TenantRunner } from '../../database/tenant';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';

function toDate(s: string) { return new Date(`${s}T00:00:00.000Z`); }
function daysBetween(start: string, end: string) { const s = toDate(start).getTime(), e = toDate(end).getTime(); return Math.floor((e - s) / 86400000) + 1; }

export function createLeaveRouter(prisma: PrismaClient, tenantRunner: TenantRunner): Router {
  const router = Router();
  const run = tenantRunner;
  const ctx = (req: any) => ({ companyId: req.user.companyId as string });

  router.get('/types', requirePermission(PERMISSIONS.LEAVE_TYPE_READ), async (req, res) => {
    const data = await run(ctx(req), async (db: any) => db.leaveType.findMany({ orderBy: { name: 'asc' } }));
    res.json({ data });
  });
  router.post('/types', requirePermission(PERMISSIONS.LEAVE_TYPE_WRITE), validate({ body: createLeaveTypeSchema }), async (req, res) => {
    try {
      const data = await run(ctx(req), async (db: any) => db.leaveType.create({ data: req.body }));
      res.status(201).json({ data });
    } catch (e: any) { if (e?.code === 'P2002') throw new ValidationError('Leave type name must be unique'); throw e; }
  });
  router.patch('/types/:id', requirePermission(PERMISSIONS.LEAVE_TYPE_WRITE), validate({ params: z.object({ id: z.string().uuid() }), body: updateLeaveTypeSchema }), async (req, res) => {
    const id = (req.params as any).id;
    try {
      const data = await run(ctx(req), async (db: any) => {
        const existing = await db.leaveType.findFirst({ where: { id } });
        if (!existing) throw new NotFoundError('Leave type not found');
        return db.leaveType.update({ where: { id }, data: req.body });
      });
      res.json({ data });
    } catch (e: any) { if (e?.code === 'P2002') throw new ValidationError('Leave type name must be unique'); throw e; }
  });

  router.get('/balances', requireAnyPermission(PERMISSIONS.LEAVE_READ_SELF, PERMISSIONS.LEAVE_READ_ALL, PERMISSIONS.LEAVE_READ_TEAM), async (req, res) => {
    const employeeId = (req.query.employeeId as string) || req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const data = await run(ctx(req), async (db: any) => {
      if (employeeId !== req.user!.employeeId && !req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_ALL)) {
        if (!req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_TEAM)) throw new ForbiddenError();
        const emp = await db.employee.findFirst({ where: { id: employeeId }, select: { managerId: true } });
        if (emp?.managerId !== req.user!.employeeId) throw new ForbiddenError();
      }
      return db.leaveBalance.findMany({ where: { employeeId, year: new Date().getUTCFullYear() }, include: { leaveType: { select: { name: true } } } });
    });
    res.json({ data: data.map((b: any) => ({ id: b.id, employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, leaveTypeName: b.leaveType?.name, year: b.year, allocated: b.allocated, adjusted: b.adjusted, used: b.used, pending: b.pendingReserved, available: b.allocated + b.adjusted - b.used - b.pendingReserved })) });
  });

  router.post('/balances/adjust', requirePermission(PERMISSIONS.LEAVE_BALANCE_ADJUST), validate({ body: adjustLeaveBalanceSchema }), async (req, res) => {
    const body = req.body as any;
    const data = await run(ctx(req), async (db: any) => {
      const bal = await db.leaveBalance.upsert({
        where: { companyId_employeeId_leaveTypeId_year: { companyId: req.user!.companyId, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year } },
        update: { adjusted: { increment: body.amount } },
        create: { companyId: req.user!.companyId, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year, adjusted: body.amount, allocated: 0 },
      }).catch(async () => {
        const existing = await db.leaveBalance.findFirst({ where: { employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year } });
        if (existing) return db.leaveBalance.update({ where: { id: existing.id }, data: { adjusted: existing.adjusted + body.amount } });
        return db.leaveBalance.create({ data: { employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year, adjusted: body.amount } });
      });
      await prisma.auditLog.create({ data: { companyId: req.user!.companyId, actorId: req.user!.userId, action: 'leave.balance_adjusted', entity: 'LeaveBalance', entityId: bal.id, newValue: { amount: body.amount, reason: body.reason, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year } } });
      return bal;
    });
    res.json({ data });
  });

  router.get('/requests', requireAnyPermission(PERMISSIONS.LEAVE_READ_SELF, PERMISSIONS.LEAVE_READ_TEAM, PERMISSIONS.LEAVE_READ_ALL), validate({ query: leaveRequestListQuerySchema }), async (req, res) => {
    const q = req.query as any;
    const where: any = {};
    if (q.status?.length) where.status = { in: q.status };
    if (q.pendingForMe) {
      where.status = 'PENDING';
      where.employee = { managerId: req.user!.employeeId };
    } else if (q.team) {
      where.employee = { managerId: req.user!.employeeId };
    } else if (q.employeeId) {
      where.employeeId = q.employeeId;
    } else if (!req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_ALL) && !req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_TEAM)) {
      where.employeeId = req.user!.employeeId;
    }
    // basic access narrowing
    if (!req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_ALL)) {
      if (req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_TEAM)) {
        // Team-only readers (Manager) may see their own and their direct reports' requests, never the whole
        // company's, whatever query flags are sent (PRD section 5; server-side scope).
        where.AND = [
          ...(where.AND ?? []),
          { OR: [{ employeeId: req.user!.employeeId }, { employee: { managerId: req.user!.employeeId } }] },
        ];
      } else {
        where.employeeId = req.user!.employeeId;
      }
    }
    const [data, total] = await Promise.all([
      prisma.leaveRequest.findMany({ where: { companyId: req.user!.companyId, ...where }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { leaveType: { select: { name: true } } } }),
      prisma.leaveRequest.count({ where: { companyId: req.user!.companyId, ...where } }),
    ]);
    res.json({ data: data.map((r: any) => ({ ...r, leaveTypeName: r.leaveType?.name })), page: { page: q.page, pageSize: q.pageSize, total } });
  });

  router.post('/requests', requirePermission(PERMISSIONS.LEAVE_APPLY), validate({ body: createLeaveRequestSchema }), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const body = req.body as any;
    const startDate = toDate(body.startDate); const endDate = toDate(body.endDate);
    if (endDate < startDate) throw new ValidationError('End date must be on or after start date');
    const days = body.dayType === 'HALF_DAY' ? 0.5 : daysBetween(body.startDate, body.endDate);
    const year = startDate.getUTCFullYear();
    const data = await run(ctx(req), async (db: any) => {
      const leaveType = await db.leaveType.findFirst({ where: { id: body.leaveTypeId, isActive: true } });
      if (!leaveType) throw new ValidationError('Leave type not found or inactive');
      if (body.dayType === 'HALF_DAY' && !leaveType.allowHalfDay) throw new ValidationError('Half-day leave is not allowed for this leave type');
      const balance = await db.leaveBalance.findFirst({ where: { employeeId, leaveTypeId: body.leaveTypeId, year } });
      const allocated = (balance?.allocated ?? leaveType.annualAllocation ?? 0) + (balance?.adjusted ?? 0);
      const available = allocated - (balance?.used ?? 0) - (balance?.pendingReserved ?? 0);
      if (available < days) throw new ValidationError('Insufficient leave balance');
      const overlap = await db.leaveRequest.findFirst({ where: { employeeId, status: { in: ['PENDING','APPROVED'] }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
      if (overlap) throw new ValidationError('Overlapping leave request exists');
      const me = await db.employee.findFirst({ where: { id: employeeId }, select: { managerId: true } });
      let approverUserId: string | null = null;
      let originalApproverUserId: string | null = null;
      if (me?.managerId) {
        const mgrMembership = await db.companyMembership.findFirst({ where: { employeeId: me.managerId }, select: { userId: true } });
        approverUserId = mgrMembership?.userId ?? null;
        originalApproverUserId = approverUserId;
      }
      const reqRow = await db.leaveRequest.create({ data: { employeeId, leaveTypeId: body.leaveTypeId, startDate, endDate, dayType: body.dayType, halfDaySession: body.halfDaySession ?? null, reason: body.reason, days, approverUserId, originalApproverUserId } });
      if (balance) await db.leaveBalance.update({ where: { id: balance.id }, data: { pendingReserved: { increment: days } } });
      else await db.leaveBalance.create({ data: { employeeId, leaveTypeId: body.leaveTypeId, year, allocated: leaveType.annualAllocation ?? 0, pendingReserved: days } });
      return reqRow;
    });
    res.status(201).json({ data });
  });

  router.patch('/requests/:id/review', requirePermission(PERMISSIONS.LEAVE_APPROVE), validate({ params: z.object({ id: z.string().uuid() }), body: leaveRequestDecisionSchema }), async (req, res) => {
    const id = (req.params as any).id; const body = req.body as any;
    const data = await run(ctx(req), async (db: any) => {
      const lr = await db.leaveRequest.findFirst({ where: { id }, include: { employee: { select: { managerId: true } } } });
      if (!lr) throw new NotFoundError('Leave request not found');
      if (lr.status !== 'PENDING') throw new ValidationError('Leave request is not pending');
      const managerEmployeeId = lr.employee?.managerId;
      const isManager = req.user!.employeeId && managerEmployeeId === req.user!.employeeId;
      const isHrSa = req.user!.permissions.includes(PERMISSIONS.LEAVE_READ_ALL);
      if (!isManager && !isHrSa) throw new ForbiddenError();
      // PRD LEAVE-005: no self-approval, for anyone (including HR Admin and Super Admin, who may approve any other request).
      if (req.user!.employeeId && lr.employeeId === req.user!.employeeId) throw new ForbiddenError();
      const updated = await db.leaveRequest.update({ where: { id }, data: { status: body.status, approverUserId: req.user!.userId, decisionComment: body.comment ?? null, decidedAt: new Date() } });
      const year = new Date(lr.startDate).getUTCFullYear();
      const bal = await db.leaveBalance.findFirst({ where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId, year } });
      if (bal) {
        if (body.status === 'APPROVED') await db.leaveBalance.update({ where: { id: bal.id }, data: { pendingReserved: { decrement: lr.days }, used: { increment: lr.days } } });
        else await db.leaveBalance.update({ where: { id: bal.id }, data: { pendingReserved: { decrement: lr.days } } });
      }
      return updated;
    });
    res.json({ data });
  });

  router.patch('/requests/:id/cancel', requireAnyPermission(PERMISSIONS.LEAVE_CANCEL_OWN, PERMISSIONS.LEAVE_CANCEL_ANY), validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
    const id = (req.params as any).id;
    const data = await run(ctx(req), async (db: any) => {
      const lr = await db.leaveRequest.findFirst({ where: { id } });
      if (!lr) throw new NotFoundError('Leave request not found');
      const isOwner = req.user!.employeeId === lr.employeeId;
      if (isOwner && !req.user!.permissions.includes(PERMISSIONS.LEAVE_CANCEL_OWN) && !req.user!.permissions.includes(PERMISSIONS.LEAVE_CANCEL_ANY)) throw new ForbiddenError();
      if (!isOwner && !req.user!.permissions.includes(PERMISSIONS.LEAVE_CANCEL_ANY)) throw new ForbiddenError();
      const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
      if (!['PENDING','APPROVED'].includes(lr.status)) throw new ValidationError('Only pending or approved requests can be cancelled');
      if (new Date(lr.startDate) < today) throw new ValidationError('Past leave cannot be cancelled');
      const updated = await db.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: req.user!.userId } });
      const year = new Date(lr.startDate).getUTCFullYear();
      const bal = await db.leaveBalance.findFirst({ where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId, year } });
      if (bal) {
        if (lr.status === 'PENDING') await db.leaveBalance.update({ where: { id: bal.id }, data: { pendingReserved: { decrement: lr.days } } });
        if (lr.status === 'APPROVED') await db.leaveBalance.update({ where: { id: bal.id }, data: { used: { decrement: lr.days } } });
      }
      return updated;
    });
    res.json({ data });
  });

  return router;
}
