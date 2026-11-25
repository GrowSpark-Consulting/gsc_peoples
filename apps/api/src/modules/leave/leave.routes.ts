import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  adjustLeaveBalanceSchema,
  can,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  leaveCalendarQuerySchema,
  leaveRequestDecisionSchema,
  leaveRequestListQuerySchema,
  updateLeaveTypeSchema,
  type LeaveCalendarScope,
} from '@gsc/contracts';
import type { Prisma, PrismaClient } from '../../database/generated/client';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission, toAuthzUser } from '../../middleware/authorization/authorize';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { recordAudit } from '../audit/audit';
import { companyDay, isWorkingStatus, parseDateOnly, toDateOnly } from '../attendance/attendance.rules';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';
import { hrUserIds, notify, userIdForEmployee } from '../notifications/notify';
import { MAX_RETROACTIVE_DAYS, availableDays, countLeaveDays, eachDate, hasStarted, isCountedDay, startsTooFarInThePast } from './leave.rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows */

const idParam = z.object({ id: z.string().uuid() });

export interface LeaveRouterOptions {
  /** Test seam for date boundaries (default: wall-clock time). */
  now?: () => Date;
}

export function createLeaveRouter(_prisma: PrismaClient, tenantRunner: TenantRunner, options: LeaveRouterOptions = {}): Router {
  const router = Router();
  const run = tenantRunner;
  const clock = options.now ?? (() => new Date());
  const ctx = (req: Request) => ({ companyId: req.user!.companyId });
  const has = (req: Request, p: string) => req.user!.permissions.includes(p);

  async function calendarOf(db: TenantDb) {
    const c = await db.company.findFirst({ select: { timezone: true, workingDays: true } });
    return {
      today: companyDay(clock(), c?.timezone),
      workingDays: (c?.workingDays as number[] | undefined) ?? [1, 2, 3, 4, 5],
    };
  }

  async function holidaysBetween(db: TenantDb, start: Date, end: Date): Promise<Map<string, string>> {
    const rows = await db.holiday.findMany({ where: { date: { gte: start, lte: end }, isActive: true }, select: { date: true, name: true } });
    return new Map((rows as { date: Date; name: string }[]).map((h) => [toDateOnly(h.date), h.name]));
  }

  /** One writer at a time per employee: balance checks and updates cannot interleave. Released at commit. */
  async function lockEmployeeLeave(tx: Prisma.TransactionClient, companyId: string, employeeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`leave:${companyId}:${employeeId}`}, 0))`;
  }

  /** The balance row for (employee, type, year), created with the type's annual allocation (LEAVE-002, A4). */
  async function ensureBalance(db: TenantDb, companyId: string, employeeId: string, leaveType: { id: string; annualAllocation: number }, year: number) {
    return db.leaveBalance.upsert({
      where: { companyId_employeeId_leaveTypeId_year: { companyId, employeeId, leaveTypeId: leaveType.id, year } },
      update: {},
      create: { employeeId, leaveTypeId: leaveType.id, year, allocated: leaveType.annualAllocation },
    });
  }

  /** Whose records the caller may read: everyone, the caller plus their team, or only the caller. */
  async function readableIds(db: TenantDb, req: Request): Promise<string[] | 'all'> {
    if (has(req, PERMISSIONS.LEAVE_READ_ALL)) return 'all';
    const own = req.user!.employeeId ? [req.user!.employeeId] : [];
    if (has(req, PERMISSIONS.LEAVE_READ_TEAM)) return [...own, ...(await resolveTeamEmployeeIds(db, req.user!.employeeId ?? null))];
    return own;
  }

  /**
   * Requests a Manager decides (PRD LEAVE-005 routing, section 5 team scope, W9): the applicant is in the
   * manager's direct or indirect team AND the request is routed inside that team, i.e. its original approver is the
   * manager or someone below them. A request routed to HR (no manager, or the applicant is a Manager) is never a
   * Manager's to decide. The original approver keeps pending requests even after a reporting change.
   */
  async function managerQueueFilter(db: TenantDb, req: Request) {
    const team = await resolveTeamEmployeeIds(db, req.user!.employeeId ?? null);
    const below = team.length
      ? await db.companyMembership.findMany({ where: { employeeId: { in: team } }, select: { userId: true } })
      : [];
    const teamUsers = (below as { userId: string }[]).map((m) => m.userId);
    return {
      OR: [
        { originalApproverUserId: req.user!.userId },
        { AND: [{ employeeId: { in: team } }, { originalApproverUserId: { in: teamUsers } }] },
      ],
    };
  }

  // ---------------------------------------------------------------- leave types (LEAVE-001)

  router.get('/types', requirePermission(PERMISSIONS.LEAVE_TYPE_READ), async (req, res) => {
    const data = await run(ctx(req), async (db) => db.leaveType.findMany({ orderBy: { name: 'asc' } }));
    res.json({ data });
  });

  router.post('/types', requirePermission(PERMISSIONS.LEAVE_TYPE_WRITE), validate({ body: createLeaveTypeSchema }), async (req, res) => {
    try {
      const data = await run(ctx(req), async (db) => {
        const row = await db.leaveType.create({ data: req.body });
        await recordAudit(db, { actorId: req.user!.userId, action: 'leave.type_created', entity: 'LeaveType', entityId: row.id, newValue: req.body });
        return row;
      });
      res.status(201).json({ data });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Leave type name must be unique');
      throw e;
    }
  });

  router.patch('/types/:id', requirePermission(PERMISSIONS.LEAVE_TYPE_WRITE), validate({ params: idParam, body: updateLeaveTypeSchema }), async (req, res) => {
    const id = String(req.params.id);
    try {
      const data = await run(ctx(req), async (db) => {
        const existing = await db.leaveType.findFirst({ where: { id } });
        if (!existing) throw new NotFoundError('Leave type not found');
        const row = await db.leaveType.update({ where: { id }, data: req.body });
        await recordAudit(db, { actorId: req.user!.userId, action: 'leave.type_updated', entity: 'LeaveType', entityId: id, oldValue: existing, newValue: req.body });
        return row;
      });
      res.json({ data });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Leave type name must be unique');
      throw e;
    }
  });

  // ---------------------------------------------------------------- balances (LEAVE-002)

  router.get('/balances', requireAnyPermission(PERMISSIONS.LEAVE_READ_SELF, PERMISSIONS.LEAVE_READ_ALL, PERMISSIONS.LEAVE_READ_TEAM), validate({ query: z.object({ employeeId: z.string().uuid().optional(), year: z.coerce.number().int().min(2000).max(2100).optional() }) }), async (req, res) => {
    const q = req.query as { employeeId?: string; year?: number };
    const employeeId = q.employeeId || req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const data = await run(ctx(req), async (db) => {
      const scope = await readableIds(db, req);
      if (scope !== 'all' && !scope.includes(employeeId)) throw new ForbiddenError();
      if (!(await db.employee.findFirst({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundError('Employee not found');
      const year = q.year ?? (await calendarOf(db)).today.getUTCFullYear();
      const [types, rows] = await Promise.all([
        db.leaveType.findMany({ orderBy: { name: 'asc' } }),
        db.leaveBalance.findMany({ where: { employeeId, year } }),
      ]);
      const byType = new Map<string, any>((rows as any[]).map((b) => [b.leaveTypeId, b]));
      // Every active type is listed; one with no row yet shows its annual allocation. Archived types stay
      // visible only where the employee has a balance.
      return (types as any[])
        .filter((t) => t.isActive || byType.has(t.id))
        .map((t) => {
          const b = byType.get(t.id) ?? { allocated: t.annualAllocation, adjusted: 0, used: 0, pendingReserved: 0 };
          return { ...(b.id ? { id: b.id } : {}), employeeId, leaveTypeId: t.id, leaveTypeName: t.name, year, allocated: b.allocated, adjusted: b.adjusted, used: b.used, pending: b.pendingReserved, available: availableDays(b) };
        });
    });
    res.json({ data });
  });

  router.post('/balances/adjust', requirePermission(PERMISSIONS.LEAVE_BALANCE_ADJUST), validate({ body: adjustLeaveBalanceSchema }), async (req, res) => {
    const body = req.body as z.infer<typeof adjustLeaveBalanceSchema>;
    const data = await run(ctx(req), async (db, tx) => {
      const employee = await db.employee.findFirst({ where: { id: body.employeeId }, select: { id: true } });
      if (!employee) throw new NotFoundError('Employee not found');
      const leaveType = await db.leaveType.findFirst({ where: { id: body.leaveTypeId } });
      if (!leaveType) throw new NotFoundError('Leave type not found');
      await lockEmployeeLeave(tx, req.user!.companyId, body.employeeId);
      const before = await ensureBalance(db, req.user!.companyId, body.employeeId, leaveType, body.year);
      const after = await db.leaveBalance.update({ where: { id: before.id }, data: { adjusted: { increment: body.amount } } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'leave.balance_adjusted', entity: 'LeaveBalance', entityId: after.id, oldValue: { adjusted: before.adjusted }, newValue: { adjusted: after.adjusted, amount: body.amount, reason: body.reason, employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year } });
      return after;
    });
    res.json({ data });
  });

  // ---------------------------------------------------------------- history and queue (LEAVE-008)

  router.get('/requests', requireAnyPermission(PERMISSIONS.LEAVE_READ_SELF, PERMISSIONS.LEAVE_READ_TEAM, PERMISSIONS.LEAVE_READ_ALL), validate({ query: leaveRequestListQuerySchema }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof leaveRequestListQuerySchema>;
    const result = await run(ctx(req), async (db) => {
      const and: any[] = [];
      const me = req.user!.employeeId;
      if (q.status?.length) and.push({ status: { in: q.status } });
      if (q.pendingForMe) {
        // "Waiting for my decision": never the caller's own request.
        and.push({ status: 'PENDING' });
        if (me) and.push({ employeeId: { not: me } });
        if (has(req, PERMISSIONS.LEAVE_DECIDE_ALL)) {
          // HR Admin and Super Admin may decide any request (A9).
        } else if (has(req, PERMISSIONS.LEAVE_DECIDE_TEAM)) {
          and.push(await managerQueueFilter(db, req));
        } else {
          and.push({ employeeId: { in: [] } });
        }
      }
      if (q.mine) and.push({ employeeId: me ?? { in: [] } });
      if (q.team) and.push({ employeeId: { in: await resolveTeamEmployeeIds(db, me ?? null) } });
      if (q.employeeId) and.push({ employeeId: q.employeeId });
      if (q.year || q.month) {
        const year = q.year ?? (await calendarOf(db)).today.getUTCFullYear();
        const start = new Date(Date.UTC(year, q.month ? q.month - 1 : 0, 1));
        const end = new Date(Date.UTC(year, q.month ? q.month : 12, 0));
        and.push({ startDate: { lte: end } }, { endDate: { gte: start } });
      }
      // Server-side scope applies whatever flags were sent (PRD section 5).
      const scope = await readableIds(db, req);
      if (scope !== 'all') {
        and.push(q.pendingForMe && has(req, PERMISSIONS.LEAVE_DECIDE_TEAM) ? { OR: [{ employeeId: { in: scope } }, { originalApproverUserId: req.user!.userId }] } : { employeeId: { in: scope } });
      }
      const where = { AND: and };
      const [rows, total] = await Promise.all([
        db.leaveRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { leaveType: { select: { name: true } } } }),
        db.leaveRequest.count({ where }),
      ]);
      return { rows, total };
    });
    res.json({ data: (result.rows as any[]).map((r) => ({ ...r, leaveTypeName: r.leaveType?.name })), page: { page: q.page, pageSize: q.pageSize, total: result.total } });
  });

  router.get('/calendar', requireAnyPermission(PERMISSIONS.LEAVE_READ_SELF, PERMISSIONS.LEAVE_READ_TEAM, PERMISSIONS.LEAVE_READ_ALL), validate({ query: leaveCalendarQuerySchema }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof leaveCalendarQuerySchema>;
    const widest: LeaveCalendarScope = has(req, PERMISSIONS.LEAVE_READ_ALL) ? 'all' : has(req, PERMISSIONS.LEAVE_READ_TEAM) ? 'team' : 'own';
    const scope = q.scope ?? widest;
    const allowed: Record<LeaveCalendarScope, boolean> = {
      own: true,
      team: has(req, PERMISSIONS.LEAVE_READ_TEAM) || has(req, PERMISSIONS.LEAVE_READ_ALL),
      all: has(req, PERMISSIONS.LEAVE_READ_ALL),
    };
    if (!allowed[scope]) throw new ForbiddenError();
    const start = new Date(Date.UTC(q.year, q.month - 1, 1));
    const end = new Date(Date.UTC(q.year, q.month, 0));
    const data = await run(ctx(req), async (db) => {
      const { workingDays } = await calendarOf(db);
      const holidays = await holidaysBetween(db, start, end);
      const me = req.user!.employeeId;
      const ids = scope === 'all' ? null : [...(me ? [me] : []), ...(scope === 'team' ? await resolveTeamEmployeeIds(db, me ?? null) : [])];
      const requests = await db.leaveRequest.findMany({
        where: { status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start }, ...(ids ? { employeeId: { in: ids } } : {}) },
        orderBy: { startDate: 'asc' },
        include: { leaveType: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } },
      });
      return eachDate(start, end).map((date) => {
        const day = toDateOnly(date);
        const counted = isCountedDay(date, workingDays, new Set(holidays.keys()));
        return {
          date: day,
          isWorkingDay: counted,
          holidayName: holidays.get(day) ?? null,
          // Leave is shown only on the days it consumes (weekends and holidays are not leave, A5).
          items: counted
            ? (requests as any[])
                .filter((r) => r.startDate <= date && r.endDate >= date)
                .map((r) => ({ requestId: r.id, employeeId: r.employeeId, employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(), leaveTypeName: r.leaveType.name, status: r.status, dayType: r.dayType, halfDaySession: r.halfDaySession }))
            : [],
        };
      });
    });
    res.json({ data, meta: { year: q.year, month: q.month, scope } });
  });

  // ---------------------------------------------------------------- apply (LEAVE-003, LEAVE-004, LEAVE-005)

  router.post('/requests', requirePermission(PERMISSIONS.LEAVE_APPLY), validate({ body: createLeaveRequestSchema }), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const body = req.body as z.infer<typeof createLeaveRequestSchema>;
    const startDate = parseDateOnly(body.startDate);
    const endDate = parseDateOnly(body.endDate);
    if (endDate < startDate) throw new ValidationError('End date must be on or after start date');
    const year = startDate.getUTCFullYear();
    // Balances are per calendar year (A4): a request never draws on two years.
    if (endDate.getUTCFullYear() !== year) throw new ValidationError('A request cannot span two calendar years. Submit one request for each year.', { code: 'SPANS_TWO_YEARS' });

    try {
      const data = await run(ctx(req), async (db, tx) => {
        const calendar = await calendarOf(db);
        const me = await db.employee.findFirst({ where: { id: employeeId }, select: { status: true, firstName: true, lastName: true, managerId: true, membership: { select: { role: { select: { key: true } } } } } });
        if (!me) throw new NotFoundError('Employee profile not found');
        if (!isWorkingStatus(me.status)) throw new ValidationError('Leave is available once your employee record is Active', { code: 'EMPLOYEE_NOT_ACTIVE' });
        if (startsTooFarInThePast(startDate, calendar.today)) throw new ValidationError(`Leave can start at most ${MAX_RETROACTIVE_DAYS} days in the past`, { code: 'START_TOO_OLD' });
        const leaveType = await db.leaveType.findFirst({ where: { id: body.leaveTypeId, isActive: true } });
        if (!leaveType) throw new ValidationError('Leave type not found or inactive');
        if (body.dayType === 'HALF_DAY' && !leaveType.allowHalfDay) throw new ValidationError('Half-day leave is not allowed for this leave type');
        const holidays = await holidaysBetween(db, startDate, endDate);
        const days = countLeaveDays({ start: startDate, end: endDate, dayType: body.dayType, workingDays: calendar.workingDays, holidays: new Set(holidays.keys()) });
        if (days === 0) throw new ValidationError('The selected dates contain no working days', { code: 'NO_WORKING_DAYS' });

        await lockEmployeeLeave(tx, req.user!.companyId, employeeId);
        const overlap = await db.leaveRequest.findFirst({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: endDate }, endDate: { gte: startDate } } });
        if (overlap) throw new ValidationError('Overlapping leave request exists');
        const balance = await ensureBalance(db, req.user!.companyId, employeeId, leaveType, year);
        if (availableDays(balance) < days) throw new ValidationError('Insufficient leave balance');

        // Routing (LEAVE-005, A9): the reporting manager; HR if there is none, if the manager cannot sign in, or if
        // the applicant is a Manager.
        const applicantIsManager = me.membership?.role?.key === 'MANAGER';
        const approverUserId = applicantIsManager ? null : await userIdForEmployee(db, me.managerId);
        // A reporting manager whose login cannot decide leave (for example an Employee-role lead): HR is told as well.
        const approver = approverUserId
          ? await db.companyMembership.findFirst({ where: { userId: approverUserId }, select: { role: { select: { key: true } } } })
          : null;
        const approverCanDecide = Boolean(approver && approver.role.key !== 'EMPLOYEE');
        const row = await db.leaveRequest.create({
          data: { employeeId, leaveTypeId: body.leaveTypeId, startDate, endDate, dayType: body.dayType, halfDaySession: body.halfDaySession ?? null, reason: body.reason, days, approverUserId, originalApproverUserId: approverUserId },
        });
        await db.leaveBalance.update({ where: { id: balance.id }, data: { pendingReserved: { increment: days } } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'leave.requested', entity: 'LeaveRequest', entityId: row.id, newValue: { employeeId, startDate: body.startDate, endDate: body.endDate, days, leaveTypeId: body.leaveTypeId } });
        await notify(db, { type: 'LEAVE_REQUESTED', eventKey: row.id, recipients: approverCanDecide ? [approverUserId] : await hrUserIds(db), actorUserId: req.user!.userId, title: `${me.firstName} ${me.lastName} requested ${leaveType.name}`, message: `${body.startDate} to ${body.endDate} (${days} day(s))`, link: '/leave' });
        return row;
      });
      res.status(201).json({ data });
    } catch (e: any) {
      // The database trigger is the backstop against overlapping ranges.
      if (/leave_requests_no_overlap|overlaps an existing/.test(String(e?.message ?? ''))) throw new ValidationError('Overlapping leave request exists');
      throw e;
    }
  });

  // ---------------------------------------------------------------- decide (LEAVE-006)

  router.patch('/requests/:id/review', requirePermission(PERMISSIONS.LEAVE_APPROVE), validate({ params: idParam, body: leaveRequestDecisionSchema }), async (req, res) => {
    const id = String(req.params.id);
    const body = req.body as z.infer<typeof leaveRequestDecisionSchema>;
    const data = await run(ctx(req), async (db, tx) => {
      const found = await db.leaveRequest.findFirst({ where: { id }, include: { leaveType: { select: { name: true } } } });
      if (!found) throw new NotFoundError('Leave request not found');
      // LEAVE-005: no self-approval, for anyone.
      if (req.user!.employeeId && found.employeeId === req.user!.employeeId) throw new ForbiddenError('You cannot decide your own request');
      if (!has(req, PERMISSIONS.LEAVE_DECIDE_ALL)) {
        const allowed = await db.leaveRequest.findFirst({ where: { AND: [{ id }, await managerQueueFilter(db, req)] }, select: { id: true } });
        if (!allowed) throw new ForbiddenError();
      }
      await lockEmployeeLeave(tx, req.user!.companyId, found.employeeId);
      // Decided once: only the request that moves it out of PENDING touches the balance.
      const claimed = await db.leaveRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: body.status, approverUserId: req.user!.userId, decisionComment: body.comment ?? null, decidedAt: clock() } });
      if (claimed.count !== 1) throw new ConflictError('Leave request is not pending; it was already decided or cancelled');
      await db.leaveBalance.updateMany({
        where: { employeeId: found.employeeId, leaveTypeId: found.leaveTypeId, year: found.startDate.getUTCFullYear() },
        data: body.status === 'APPROVED' ? { pendingReserved: { decrement: found.days }, used: { increment: found.days } } : { pendingReserved: { decrement: found.days } },
      });
      await recordAudit(db, { actorId: req.user!.userId, action: body.status === 'APPROVED' ? 'leave.approved' : 'leave.rejected', entity: 'LeaveRequest', entityId: id, oldValue: { status: 'PENDING' }, newValue: { status: body.status, comment: body.comment ?? null } });
      await notify(db, {
        type: body.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        eventKey: id,
        recipients: [await userIdForEmployee(db, found.employeeId)],
        actorUserId: req.user!.userId,
        title: `Your ${found.leaveType.name} request was ${body.status === 'APPROVED' ? 'approved' : 'rejected'}`,
        message: `${toDateOnly(found.startDate)} to ${toDateOnly(found.endDate)}`,
        link: '/leave',
      });
      return db.leaveRequest.findFirst({ where: { id } });
    });
    res.json({ data });
  });

  // ---------------------------------------------------------------- cancel (LEAVE-007)

  router.patch('/requests/:id/cancel', requireAnyPermission(PERMISSIONS.LEAVE_CANCEL_OWN, PERMISSIONS.LEAVE_CANCEL_ANY), validate({ params: idParam }), async (req, res) => {
    const id = String(req.params.id);
    const data = await run(ctx(req), async (db, tx) => {
      const first = await db.leaveRequest.findFirst({ where: { id } });
      if (!first) throw new NotFoundError('Leave request not found');
      await lockEmployeeLeave(tx, req.user!.companyId, first.employeeId);
      const lr = await db.leaveRequest.findFirst({ where: { id }, include: { leaveType: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } } });
      const isOwner = req.user!.employeeId === lr.employeeId;
      if (!isOwner && !has(req, PERMISSIONS.LEAVE_CANCEL_ANY)) throw new ForbiddenError();
      if (lr.status !== 'PENDING' && lr.status !== 'APPROVED') throw new ConflictError('Only pending or approved requests can be cancelled');
      const { today } = await calendarOf(db);
      // The owner may cancel Pending, or Approved that has not started; after the start only HR / Super Admin.
      if (!can(toAuthzUser(req.user!), 'leave.cancel', { ownerEmployeeId: lr.employeeId, status: lr.status, leaveStarted: hasStarted(lr.startDate, today) })) {
        throw new ForbiddenError('This leave has already started. Ask HR to cancel it.');
      }
      const claimed = await db.leaveRequest.updateMany({ where: { id, status: lr.status }, data: { status: 'CANCELLED', cancelledAt: clock(), cancelledByUserId: req.user!.userId } });
      if (claimed.count !== 1) throw new ConflictError('The request changed while you were cancelling it. Reload and try again.');
      await db.leaveBalance.updateMany({
        where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId, year: lr.startDate.getUTCFullYear() },
        data: lr.status === 'PENDING' ? { pendingReserved: { decrement: lr.days } } : { used: { decrement: lr.days } },
      });
      await recordAudit(db, { actorId: req.user!.userId, action: 'leave.cancelled', entity: 'LeaveRequest', entityId: id, oldValue: { status: lr.status }, newValue: { status: 'CANCELLED' } });
      // The other side is told: the approver when the employee cancels, the employee when HR does.
      const recipients = isOwner
        ? lr.approverUserId ? [lr.approverUserId] : await hrUserIds(db)
        : [await userIdForEmployee(db, lr.employeeId)];
      await notify(db, { type: 'LEAVE_CANCELLED', eventKey: id, recipients, actorUserId: req.user!.userId, title: `${lr.leaveType.name} cancelled for ${lr.employee.firstName} ${lr.employee.lastName}`, message: `${toDateOnly(lr.startDate)} to ${toDateOnly(lr.endDate)}`, link: '/leave' });
      return db.leaveRequest.findFirst({ where: { id } });
    });
    res.json({ data });
  });

  return router;
}
