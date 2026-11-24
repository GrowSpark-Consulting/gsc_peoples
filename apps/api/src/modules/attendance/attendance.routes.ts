import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  attendanceHistoryQuerySchema,
  attendanceOverviewQuerySchema,
  createAttendanceCorrectionSchema,
  manualAttendanceCorrectionSchema,
  reviewAttendanceCorrectionSchema,
} from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';
import {
  CORRECTION_WINDOW_DAYS,
  checkCorrectionWindow,
  companyDay,
  companyMinutes,
  daysBetween,
  deriveOverviewStatus,
  isoWeekday,
  parseDateOnly,
  toDateOnly,
  type OverviewStatus,
} from './attendance.rules';

const dateOnly = toDateOnly;
const toDate = parseDateOnly;

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

/** Optional clock override so boundary tests do not depend on wall-clock time. */
export interface AttendanceRouterOptions {
  now?: () => Date;
}

export function createAttendanceRouter(_prisma: PrismaClient, tenantRunner: TenantRunner, options: AttendanceRouterOptions = {}): Router {
  const router = Router();
  const run = tenantRunner;
  const clock = options.now ?? (() => new Date());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- express request augmented by the auth middleware
  const ctx = (req: any) => ({ companyId: req.user.companyId as string });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const has = (req: any, p: string) => (req.user.permissions as string[]).includes(p);

  /** Company calendar settings. "Today" everywhere in this router is the date in the company's time zone. */
  async function companyCalendar(db: TenantDb, now: Date) {
    const c = await db.company.findFirst({ select: { timezone: true, workingDays: true, workEndTime: true } });
    return {
      timezone: (c?.timezone as string | undefined) ?? 'UTC',
      workingDays: (c?.workingDays as number[] | undefined) ?? [1, 2, 3, 4, 5],
      workEndTime: (c?.workEndTime as string | undefined) ?? '18:00',
      today: companyDay(now, c?.timezone),
      localMinutes: companyMinutes(now, c?.timezone),
    };
  }

  /**
   * Row-level scope for one employee's attendance. HR Admin / Super Admin: whole company. Manager: self plus
   * direct and indirect reports. Employee: self only. The tenant runner confines every query to the company,
   * so another company's employee id is simply "not found" for everyone.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function canAccessEmployee(db: TenantDb, req: any, employeeId: string) {
    if (has(req, PERMISSIONS.ATTENDANCE_READ_ALL) || has(req, PERMISSIONS.EMPLOYEE_READ_ALL)) return true;
    if (employeeId === req.user.employeeId) return true;
    if (has(req, PERMISSIONS.ATTENDANCE_READ_TEAM) || has(req, PERMISSIONS.EMPLOYEE_READ_TEAM)) {
      return (await resolveTeamEmployeeIds(db, req.user.employeeId ?? null)).includes(employeeId);
    }
    return false;
  }

  router.get('/today', requireAnyPermission(PERMISSIONS.ATTENDANCE_CHECK, PERMISSIONS.ATTENDANCE_READ_SELF), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const { today, row } = await run(ctx(req), async (db) => {
      const cal = await companyCalendar(db, clock());
      return { today: cal.today, row: await db.attendanceRecord.findFirst({ where: { employeeId, date: cal.today } }) };
    });
    res.json({ data: { date: dateOnly(today), record: row, state: !row?.checkInAt ? 'NOT_CHECKED_IN' : !row?.checkOutAt ? 'CHECKED_IN' : 'DONE' } });
  });

  router.post('/check-in', requirePermission(PERMISSIONS.ATTENDANCE_CHECK), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const now = clock();
    let row;
    try {
      row = await run(ctx(req), async (db) => {
        const cal = await companyCalendar(db, now);
        const today = cal.today;
        if (!cal.workingDays.includes(isoWeekday(today))) throw new ValidationError('Today is not a working day');
        const holiday = await db.holiday.findFirst({ where: { date: today, isActive: true } }).catch(() => null);
        if (holiday) throw new ValidationError('Today is a holiday');
        const existing = await db.attendanceRecord.findFirst({ where: { employeeId, date: today } });
        if (existing?.checkInAt) throw new ConflictError('Already checked in today');
        if (existing) return db.attendanceRecord.update({ where: { id: existing.id }, data: { checkInAt: now } });
        return db.attendanceRecord.create({ data: { employeeId, date: today, checkInAt: now } });
      });
    } catch (e) {
      // Two concurrent check-ins: the unique (company, employee, date) index lets exactly one through.
      if (isUniqueViolation(e)) throw new ConflictError('Already checked in today');
      throw e;
    }
    res.status(201).json({ data: row });
  });

  router.post('/check-out', requirePermission(PERMISSIONS.ATTENDANCE_CHECK), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const now = clock();
    const row = await run(ctx(req), async (db) => {
      const { today } = await companyCalendar(db, now);
      const existing = await db.attendanceRecord.findFirst({ where: { employeeId, date: today } });
      if (!existing?.checkInAt) throw new ValidationError('Check in before checking out');
      if (existing.checkOutAt) throw new ValidationError('Already checked out today');
      if (now <= existing.checkInAt) throw new ValidationError('Check-out must be after check-in');
      const workedMinutes = Math.max(0, Math.round((now.getTime() - existing.checkInAt.getTime()) / 60000));
      return db.attendanceRecord.update({ where: { id: existing.id }, data: { checkOutAt: now, workedMinutes } });
    });
    res.json({ data: row });
  });

  router.get('/history', requireAnyPermission(PERMISSIONS.ATTENDANCE_READ_ALL, PERMISSIONS.ATTENDANCE_READ_TEAM, PERMISSIONS.ATTENDANCE_READ_SELF), validate({ query: attendanceHistoryQuerySchema }), async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = req.query as any;
    const targetEmployeeId = q.employeeId || req.user!.employeeId;
    if (!targetEmployeeId) throw new NotFoundError('Employee profile not found');
    const data = await run(ctx(req), async (db) => {
      if (!(await canAccessEmployee(db, req, targetEmployeeId))) throw new ForbiddenError();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { employeeId: targetEmployeeId };
      if (q.from || q.to) where.date = { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) };
      else if (q.year || q.month) {
        const year = Number(q.year ?? new Date().getUTCFullYear());
        const month = q.month ? Number(q.month) - 1 : 0;
        const start = q.month ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year, 0, 1));
        const end = q.month ? new Date(Date.UTC(year, month + 1, 1)) : new Date(Date.UTC(year + 1, 0, 1));
        where.date = { gte: start, lt: end };
      }
      const [rows, total] = await Promise.all([
        db.attendanceRecord.findMany({ where, orderBy: { date: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        db.attendanceRecord.count({ where }),
      ]);
      return { rows, total };
    });
    res.json({ data: data.rows, page: { page: q.page, pageSize: q.pageSize, total: data.total } });
  });

  // ATT-004 -------------------------------------------------------------------------------------------------
  /**
   * HR attendance overview for one date. HR Admin and Super Admin only (ATTENDANCE_READ_ALL): a Manager or
   * Employee gets 403. Employees are the company's non-terminated staff who had joined by that date; status per
   * employee follows `deriveOverviewStatus` (no check-in is NOT_YET_IN until the day is over for them).
   * Paginated on the employee list; the per-status summary counts every matching employee.
   */
  router.get('/overview', requirePermission(PERMISSIONS.ATTENDANCE_READ_ALL), validate({ query: attendanceOverviewQuerySchema }), async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = req.query as any;
    const now = clock();
    const date = toDate(q.date);

    const result = await run(ctx(req), async (db) => {
      const { workingDays, workEndTime, today, localMinutes } = await companyCalendar(db, now);
      if (daysBetween(date, today) < 0) throw new ValidationError('Attendance overview is not available for a future date');
      const holiday = await db.holiday.findFirst({ where: { date, isActive: true }, select: { name: true } });
      const isWorkingDay = workingDays.includes(isoWeekday(date));

      // Who is reportable on this date: not terminated/inactive-before-date, already hired. Employees whose
      // exit date is before the date, or who join after it, have no attendance expectation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const and: any[] = [
        { status: { notIn: ['TERMINATED', 'INACTIVE'] } },
        { OR: [{ joiningDate: null }, { joiningDate: { lte: date } }] },
        { OR: [{ exitDate: null }, { exitDate: { gte: date } }] },
      ];
      if (q.departmentId) and.push({ departmentId: q.departmentId });
      if (q.search) {
        and.push({
          OR: [
            { firstName: { contains: q.search, mode: 'insensitive' } },
            { lastName: { contains: q.search, mode: 'insensitive' } },
            { employeeNumber: { contains: q.search, mode: 'insensitive' } },
          ],
        });
      }
      const employees = await db.employee.findMany({
        where: { AND: and },
        select: { id: true, employeeNumber: true, firstName: true, lastName: true, departmentId: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      });
      const ids = employees.map((e: { id: string }) => e.id);
      const [records, leaves, departments] = await Promise.all([
        db.attendanceRecord.findMany({ where: { date, employeeId: { in: ids } } }),
        db.leaveRequest.findMany({
          where: { status: 'APPROVED', startDate: { lte: date }, endDate: { gte: date }, employeeId: { in: ids } },
          select: { employeeId: true, dayType: true },
        }),
        db.department.findMany({ select: { id: true, name: true } }),
      ]);
      const recordBy = new Map<string, (typeof records)[number]>(records.map((r: { employeeId: string }) => [r.employeeId, r]));
      const fullLeave = new Set<string>();
      const halfLeave = new Set<string>();
      for (const l of leaves as { employeeId: string; dayType: string }[]) (l.dayType === 'FULL_DAY' ? fullLeave : halfLeave).add(l.employeeId);
      const deptName = new Map<string, string>(departments.map((d: { id: string; name: string }) => [d.id, d.name]));

      const all = employees.map((e: { id: string; employeeNumber: string; firstName: string; lastName: string; departmentId: string | null }) => {
        const rec = recordBy.get(e.id);
        const status: OverviewStatus = deriveOverviewStatus({
          date,
          today,
          localMinutes,
          workingDays,
          workEndTime,
          isHoliday: Boolean(holiday),
          onFullDayLeave: fullLeave.has(e.id),
          checkInAt: rec?.checkInAt ?? null,
          checkOutAt: rec?.checkOutAt ?? null,
        });
        return {
          employeeId: e.id,
          employeeNumber: e.employeeNumber,
          name: `${e.firstName} ${e.lastName}`.trim(),
          departmentId: e.departmentId,
          departmentName: e.departmentId ? (deptName.get(e.departmentId) ?? null) : null,
          status,
          checkInAt: rec?.checkInAt ? rec.checkInAt.toISOString() : null,
          checkOutAt: rec?.checkOutAt ? rec.checkOutAt.toISOString() : null,
          workedMinutes: rec?.workedMinutes ?? null,
          halfDayLeave: halfLeave.has(e.id),
          holidayName: holiday?.name ?? null,
          corrected: Boolean(rec?.lastCorrectedAt),
        };
      });
      const summary: Record<string, number> = { PRESENT: 0, ABSENT: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEKEND: 0, NOT_YET_IN: 0, MISSING_CHECKOUT: 0 };
      for (const r of all) summary[r.status] = (summary[r.status] ?? 0) + 1;
      const filtered = q.status ? all.filter((r: { status: string }) => r.status === q.status) : all;
      const start = (q.page - 1) * q.pageSize;
      return {
        rows: filtered.slice(start, start + q.pageSize),
        total: filtered.length,
        summary,
        meta: { date: q.date, isWorkingDay, isHoliday: Boolean(holiday), holidayName: holiday?.name ?? null },
      };
    });
    res.json({ data: result.rows, page: { page: q.page, pageSize: q.pageSize, total: result.total }, summary: result.summary, meta: result.meta });
  });

  // ATT-005 -------------------------------------------------------------------------------------------------
  router.post('/corrections', requirePermission(PERMISSIONS.ATTENDANCE_CORRECT_REQUEST), validate({ body: createAttendanceCorrectionSchema }), async (req, res) => {
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;
    const inAt = new Date(body.proposedCheckInAt);
    const outAt = new Date(body.proposedCheckOutAt);
    if (!(inAt < outAt)) throw new ValidationError('Proposed check-out must be after check-in');
    const date = toDate(body.date);
    let row;
    try {
      row = await run(ctx(req), async (db) => {
        const window = checkCorrectionWindow(date, (await companyCalendar(db, clock())).today);
        if (!window.ok) {
          throw new ValidationError(
            window.reason === 'FUTURE' ? 'Corrections cannot be requested for a future date' : `Corrections can only be requested within ${CORRECTION_WINDOW_DAYS} days of the attendance date`,
            { code: window.reason === 'FUTURE' ? 'CORRECTION_DATE_IN_FUTURE' : 'CORRECTION_WINDOW_EXPIRED', windowDays: CORRECTION_WINDOW_DAYS },
          );
        }
        const existing = await db.attendanceRecord.findFirst({ where: { employeeId, date } });
        const dup = await db.attendanceCorrection.findFirst({ where: { employeeId, date, status: 'PENDING' } });
        if (dup) throw new ConflictError('A pending correction already exists for this date');
        return db.attendanceCorrection.create({
          data: { employeeId, date, proposedCheckInAt: inAt, proposedCheckOutAt: outAt, reason: body.reason, originalCheckInAt: existing?.checkInAt ?? null, originalCheckOutAt: existing?.checkOutAt ?? null },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('A pending correction already exists for this date');
      throw e;
    }
    res.status(201).json({ data: row });
  });

  router.get('/corrections', requireAnyPermission(PERMISSIONS.ATTENDANCE_CORRECT_APPROVE, PERMISSIONS.ATTENDANCE_READ_SELF, PERMISSIONS.ATTENDANCE_READ_ALL), async (req, res) => {
    const data = await run(ctx(req), async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {};
      if (has(req, PERMISSIONS.ATTENDANCE_READ_ALL)) {
        // HR Admin / Super Admin: the whole company (tenant-confined by the runner)
      } else if (has(req, PERMISSIONS.ATTENDANCE_CORRECT_APPROVE)) {
        // Manager: own requests plus the team's (direct and indirect reports), never the rest of the company
        const team = await resolveTeamEmployeeIds(db, req.user!.employeeId ?? null);
        where.employeeId = { in: [...team, ...(req.user!.employeeId ? [req.user!.employeeId] : [])] };
      } else {
        where.employeeId = req.user!.employeeId ?? '00000000-0000-0000-0000-000000000000';
      }
      return db.attendanceCorrection.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    });
    res.json({ data });
  });

  router.patch('/corrections/:id/review', requirePermission(PERMISSIONS.ATTENDANCE_CORRECT_APPROVE), validate({ params: z.object({ id: z.string().uuid() }), body: reviewAttendanceCorrectionSchema }), async (req, res) => {
    const id = (req.params as { id: string }).id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;
    const result = await run(ctx(req), async (db) => {
      const corr = await db.attendanceCorrection.findFirst({ where: { id } });
      if (!corr) throw new NotFoundError('Correction request not found');
      // Nobody decides their own request, whatever their role (same rule as LEAVE-005)
      if (req.user!.employeeId && corr.employeeId === req.user!.employeeId) throw new ForbiddenError('You cannot review your own correction request');
      const isHrSa = has(req, PERMISSIONS.ATTENDANCE_READ_ALL);
      if (!isHrSa) {
        const team = await resolveTeamEmployeeIds(db, req.user!.employeeId ?? null);
        if (!team.includes(corr.employeeId)) throw new ForbiddenError();
      }
      if (corr.status !== 'PENDING') throw new ConflictError('Correction request is already reviewed');
      if (body.status === 'APPROVED') {
        const workedMinutes = Math.max(0, Math.round((new Date(corr.proposedCheckOutAt).getTime() - new Date(corr.proposedCheckInAt).getTime()) / 60000));
        const existing = await db.attendanceRecord.findFirst({ where: { employeeId: corr.employeeId, date: corr.date } });
        const stamp = { lastCorrectedAt: clock(), lastCorrectedByUserId: req.user!.userId };
        if (existing) {
          await db.attendanceRecord.update({ where: { id: existing.id }, data: { checkInAt: corr.proposedCheckInAt, checkOutAt: corr.proposedCheckOutAt, workedMinutes, originalCheckInAt: existing.originalCheckInAt ?? existing.checkInAt, originalCheckOutAt: existing.originalCheckOutAt ?? existing.checkOutAt, correctionReason: corr.reason, ...stamp } });
        } else {
          await db.attendanceRecord.create({ data: { employeeId: corr.employeeId, date: corr.date, checkInAt: corr.proposedCheckInAt, checkOutAt: corr.proposedCheckOutAt, workedMinutes, correctionReason: corr.reason, ...stamp } });
        }
        await db.auditLog.create({
          data: {
            actorId: req.user!.userId,
            action: 'attendance.correction_approved',
            entity: 'AttendanceRecord',
            entityId: existing?.id ?? corr.id,
            oldValue: { employeeId: corr.employeeId, date: dateOnly(corr.date), checkInAt: existing?.checkInAt ?? null, checkOutAt: existing?.checkOutAt ?? null },
            newValue: { checkInAt: corr.proposedCheckInAt, checkOutAt: corr.proposedCheckOutAt, reason: corr.reason, correctionId: corr.id },
          },
        });
      }
      return db.attendanceCorrection.update({ where: { id }, data: { status: body.status, reviewerId: req.user!.userId, reviewerComment: body.comment ?? null, reviewedAt: clock() } });
    });
    res.json({ data: result });
  });

  // ATT-007 -------------------------------------------------------------------------------------------------
  /**
   * HR manual correction. HR Admin / Super Admin (ATTENDANCE_CORRECT_MANUAL) set or clear the check-in and
   * check-out of one employee on one past-or-present date. Omitted field = keep the stored value, explicit
   * null = clear it. The original values are kept on the record (first correction wins) and every change is
   * written, with actor, time, reason, old and new values, to the append-only audit log in the same
   * transaction. Nobody corrects their own attendance this way (403): they use the request flow, which a
   * different person approves.
   */
  router.post('/manual-corrections', requirePermission(PERMISSIONS.ATTENDANCE_CORRECT_MANUAL), validate({ body: manualAttendanceCorrectionSchema }), async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = req.body as any;
    const now = clock();
    const date = toDate(body.date);
    if (body.employeeId === req.user!.employeeId) throw new ForbiddenError('You cannot manually correct your own attendance');
    if (body.checkInAt === undefined && body.checkOutAt === undefined) throw new ValidationError('Provide checkInAt, checkOutAt or both');

    let row;
    try {
      row = await run(ctx(req), async (db) => {
        if (daysBetween(date, (await companyCalendar(db, now)).today) < 0) throw new ValidationError('Attendance cannot be corrected for a future date', { code: 'CORRECTION_DATE_IN_FUTURE' });
        const employee = await db.employee.findFirst({ where: { id: body.employeeId }, select: { id: true, status: true, joiningDate: true } });
        if (!employee) throw new NotFoundError('Employee not found');
        if (employee.status === 'TERMINATED' || employee.status === 'INACTIVE') throw new ValidationError('Attendance cannot be corrected for an inactive or terminated employee');

        const existing = await db.attendanceRecord.findFirst({ where: { employeeId: body.employeeId, date } });
        const pending = await db.attendanceCorrection.findFirst({ where: { employeeId: body.employeeId, date, status: 'PENDING' }, select: { id: true } });
        if (pending) throw new ConflictError('A pending correction request exists for this date; review it first', { pendingCorrectionId: pending.id });

        const nextIn: Date | null = body.checkInAt === undefined ? (existing?.checkInAt ?? null) : body.checkInAt === null ? null : new Date(body.checkInAt);
        const nextOut: Date | null = body.checkOutAt === undefined ? (existing?.checkOutAt ?? null) : body.checkOutAt === null ? null : new Date(body.checkOutAt);
        if (nextOut && !nextIn) throw new ValidationError('A check-out requires a check-in');
        if (nextIn && nextOut && !(nextIn < nextOut)) throw new ValidationError('Check-out must be after check-in');
        if (nextIn && nextIn > now) throw new ValidationError('Check-in cannot be in the future');
        if (nextOut && nextOut > now) throw new ValidationError('Check-out cannot be in the future');
        if (!nextIn && !nextOut && !existing) throw new ValidationError('Nothing to correct: there is no attendance record for this date');
        const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
        if (existing && same(nextIn, existing.checkInAt) && same(nextOut, existing.checkOutAt)) throw new ConflictError('The attendance record already has these values');

        const workedMinutes = nextIn && nextOut ? Math.max(0, Math.round((nextOut.getTime() - nextIn.getTime()) / 60000)) : null;
        const stamp = { correctionReason: body.reason, lastCorrectedAt: now, lastCorrectedByUserId: req.user!.userId };
        const saved = existing
          ? await db.attendanceRecord.update({
              where: { id: existing.id },
              data: { checkInAt: nextIn, checkOutAt: nextOut, workedMinutes, originalCheckInAt: existing.originalCheckInAt ?? existing.checkInAt, originalCheckOutAt: existing.originalCheckOutAt ?? existing.checkOutAt, ...stamp },
            })
          : await db.attendanceRecord.create({ data: { employeeId: body.employeeId, date, checkInAt: nextIn, checkOutAt: nextOut, workedMinutes, ...stamp } });
        await db.auditLog.create({
          data: {
            actorId: req.user!.userId,
            action: 'attendance.manual_correction',
            entity: 'AttendanceRecord',
            entityId: saved.id,
            oldValue: existing ? { employeeId: body.employeeId, date: body.date, checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt, workedMinutes: existing.workedMinutes } : null,
            newValue: { employeeId: body.employeeId, date: body.date, checkInAt: nextIn, checkOutAt: nextOut, workedMinutes, reason: body.reason, correctedAt: now },
          },
        });
        return saved;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('The attendance record was changed concurrently; retry');
      throw e;
    }
    res.status(200).json({ data: { ...row, workedHours: row.workedMinutes == null ? null : Math.round((row.workedMinutes / 60) * 100) / 100 } });
  });

  return router;
}
