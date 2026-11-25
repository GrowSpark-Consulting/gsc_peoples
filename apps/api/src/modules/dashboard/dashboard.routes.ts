import { Router, type Request } from 'express';
import { PERMISSIONS } from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { requireAnyPermission } from '../../middleware/authorization/authorize';
import { NotFoundError } from '../../shared/errors';
import { WORKING_STATUSES, companyDay, companyMinutes, deriveOverviewStatus, toDateOnly, type OverviewStatus } from '../attendance/attendance.rules';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';
import { availableDays } from '../leave/leave.rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows */

/**
 * DASH-001..003. Every number is a live query inside the caller's tenant; a database failure is an error response,
 * never a zero. Attendance states use the same policy as the attendance overview, so the counts match its list.
 */
export function createDashboardRouter(_prisma: PrismaClient, tenantRunner: TenantRunner, options: { now?: () => Date } = {}): Router {
  const router = Router();
  const run = tenantRunner;
  const clock = options.now ?? (() => new Date());
  const ctx = (req: Request) => ({ companyId: req.user!.companyId });

  async function calendarOf(db: TenantDb) {
    const c = await db.company.findFirst({ select: { timezone: true, workingDays: true, workEndTime: true } });
    const now = clock();
    return {
      workingDays: (c?.workingDays as number[] | undefined) ?? [1, 2, 3, 4, 5],
      workEndTime: (c?.workEndTime as string | undefined) ?? '18:00',
      today: companyDay(now, c?.timezone),
      localMinutes: companyMinutes(now, c?.timezone),
    };
  }

  /** Today's attendance state of the given working employees, counted per status. */
  async function todayCounts(db: TenantDb, calendar: Awaited<ReturnType<typeof calendarOf>>, ids: string[]) {
    const { today } = calendar;
    const [records, leaves, holiday] = await Promise.all([
      db.attendanceRecord.findMany({ where: { date: today, employeeId: { in: ids } }, select: { employeeId: true, checkInAt: true, checkOutAt: true } }),
      db.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', dayType: 'FULL_DAY', startDate: { lte: today }, endDate: { gte: today } }, select: { employeeId: true } }),
      db.holiday.findFirst({ where: { date: today, isActive: true }, select: { id: true } }),
    ]);
    const recordBy = new Map<string, any>((records as any[]).map((r) => [r.employeeId, r]));
    const onLeave = new Set((leaves as { employeeId: string }[]).map((l) => l.employeeId));
    const counts: Record<OverviewStatus, number> = { PRESENT: 0, ABSENT: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEKEND: 0, NOT_YET_IN: 0, MISSING_CHECKOUT: 0 };
    for (const id of ids) {
      const rec = recordBy.get(id);
      counts[
        deriveOverviewStatus({
          date: today,
          today,
          localMinutes: calendar.localMinutes,
          workingDays: calendar.workingDays,
          workEndTime: calendar.workEndTime,
          isHoliday: Boolean(holiday),
          onFullDayLeave: onLeave.has(id),
          checkInAt: rec?.checkInAt ?? null,
          checkOutAt: rec?.checkOutAt ?? null,
        })
      ] += 1;
    }
    return { present: counts.PRESENT + counts.MISSING_CHECKOUT, absent: counts.ABSENT, notYetIn: counts.NOT_YET_IN, onLeave: counts.ON_LEAVE };
  }

  /** People expected at work who had joined by today. */
  const workingWhere = (today: Date) => ({
    AND: [{ status: { in: [...WORKING_STATUSES] } }, { OR: [{ joiningDate: null }, { joiningDate: { lte: today } }] }],
  });

  router.get('/hr', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_ALL), async (req, res) => {
    const data = await run(ctx(req), async (db) => {
      const calendar = await calendarOf(db);
      const { today } = calendar;
      const since = new Date(today.getTime() - 30 * 86_400_000);
      const [totalEmployees, working, pendingLeaves, pendingCorrections, joiners, activity] = await Promise.all([
        // EMP-006: Inactive people are excluded from counts.
        db.employee.count({ where: { status: { notIn: ['INACTIVE', 'TERMINATED'] } } }),
        db.employee.findMany({ where: workingWhere(today), select: { id: true } }),
        // The caller's own requests are not theirs to approve.
        db.leaveRequest.count({ where: { status: 'PENDING', ...(req.user!.employeeId ? { employeeId: { not: req.user!.employeeId } } : {}) } }),
        db.attendanceCorrection.count({ where: { status: 'PENDING', ...(req.user!.employeeId ? { employeeId: { not: req.user!.employeeId } } : {}) } }),
        db.employee.findMany({
          where: { status: { notIn: ['INACTIVE', 'TERMINATED'] }, joiningDate: { gte: since, lte: today } },
          orderBy: [{ joiningDate: 'desc' }, { lastName: 'asc' }],
          select: { id: true, firstName: true, lastName: true, employeeNumber: true, joiningDate: true },
        }),
        // Only who did what and when: the old and new values are for the Super Admin audit log (SET-004).
        db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, action: true, entity: true, entityId: true, createdAt: true, actor: { select: { name: true } } } }),
      ]);
      const counts = await todayCounts(db, calendar, (working as { id: string }[]).map((e) => e.id));
      return {
        totalEmployees,
        activeEmployees: working.length,
        presentToday: counts.present,
        absentToday: counts.absent,
        notYetInToday: counts.notYetIn,
        onLeaveToday: counts.onLeave,
        pendingApprovals: pendingLeaves + pendingCorrections,
        joinersLast30Days: joiners.length,
        joiners: (joiners as any[]).map((j) => ({ id: j.id, name: `${j.firstName} ${j.lastName}`.trim(), employeeNumber: j.employeeNumber, joiningDate: toDateOnly(j.joiningDate) })),
        recentActivities: (activity as any[]).map((a) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, createdAt: a.createdAt, actorName: a.actor?.name ?? null })),
      };
    });
    res.json({ data });
  });

  router.get('/manager', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_TEAM), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const data = await run(ctx(req), async (db) => {
      const calendar = await calendarOf(db);
      const { today } = calendar;
      // DASH-002: direct and indirect reports.
      const teamIds = await resolveTeamEmployeeIds(db, employeeId);
      const [members, working] = await Promise.all([
        db.employee.count({ where: { id: { in: teamIds }, status: { notIn: ['INACTIVE', 'TERMINATED'] } } }),
        db.employee.findMany({ where: { AND: [{ id: { in: teamIds } }, workingWhere(today)] }, select: { id: true } }),
      ]);
      const below = teamIds.length ? await db.companyMembership.findMany({ where: { employeeId: { in: teamIds } }, select: { userId: true } }) : [];
      const [pendingLeaves, pendingCorrections, upcoming] = await Promise.all([
        // The same routing as the approval queue.
        db.leaveRequest.count({
          where: {
            status: 'PENDING',
            employeeId: { not: employeeId },
            OR: [{ originalApproverUserId: req.user!.userId }, { AND: [{ employeeId: { in: teamIds } }, { originalApproverUserId: { in: (below as { userId: string }[]).map((m) => m.userId) } }] }],
          },
        }),
        db.attendanceCorrection.count({ where: { status: 'PENDING', employeeId: { in: teamIds } } }),
        db.leaveRequest.findMany({
          where: { employeeId: { in: teamIds }, status: { in: ['APPROVED', 'PENDING'] }, endDate: { gte: today } },
          orderBy: { startDate: 'asc' },
          take: 20,
          include: { employee: { select: { firstName: true, lastName: true } }, leaveType: { select: { name: true } } },
        }),
      ]);
      const counts = await todayCounts(db, calendar, (working as { id: string }[]).map((e) => e.id));
      return {
        teamMembers: members,
        teamAttendance: counts,
        pendingApprovals: pendingLeaves + pendingCorrections,
        teamLeaveCalendar: (upcoming as any[]).map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
          leaveTypeName: r.leaveType.name,
          startDate: toDateOnly(r.startDate),
          endDate: toDateOnly(r.endDate),
          dayType: r.dayType,
          days: r.days,
          status: r.status,
        })),
      };
    });
    res.json({ data });
  });

  router.get('/employee', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_SELF), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const data = await run(ctx(req), async (db) => {
      const { today } = await calendarOf(db);
      const year = today.getUTCFullYear();
      const [profile, todayAttendance, types, balances, requests, notifications] = await Promise.all([
        db.employee.findFirst({ where: { id: employeeId }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, workEmail: true, status: true, jobTitle: true } }),
        db.attendanceRecord.findFirst({ where: { employeeId, date: today } }),
        db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        db.leaveBalance.findMany({ where: { employeeId, year } }),
        db.leaveRequest.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' }, take: 10, include: { leaveType: { select: { name: true } } } }),
        db.notification.findMany({ where: { userId: req.user!.userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      ]);
      // DASH-003: the button shows the true server state.
      const action = !todayAttendance?.checkInAt ? ('CHECK_IN' as const) : !todayAttendance.checkOutAt ? ('CHECK_OUT' as const) : ('DONE' as const);
      const byType = new Map<string, any>((balances as any[]).map((b) => [b.leaveTypeId, b]));
      return {
        profileSummary: profile,
        attendanceState: { action, today: todayAttendance },
        leaveBalances: (types as any[]).map((t) => {
          const b = byType.get(t.id) ?? { allocated: t.annualAllocation, adjusted: 0, used: 0, pendingReserved: 0 };
          return { leaveTypeId: t.id, leaveTypeName: t.name, year, allocated: b.allocated, adjusted: b.adjusted, used: b.used, pending: b.pendingReserved, available: availableDays(b) };
        }),
        leaveRequests: (requests as any[]).map((r) => ({ ...r, leaveTypeName: r.leaveType?.name })),
        notifications,
      };
    });
    res.json({ data });
  });

  return router;
}
