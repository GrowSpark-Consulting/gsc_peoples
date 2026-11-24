import { Router } from 'express';
import { PERMISSIONS } from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { NotFoundError } from '../../shared/errors';
import { companyDay } from '../attendance/attendance.rules';

export function createDashboardRouter(prisma: PrismaClient): Router {
  const router = Router();

  /** Today's date in the company's time zone, the same basis as attendance check-in (UTC-midnight Date). */
  async function companyToday(companyId: string): Promise<Date> {
    const c = await prisma.company.findFirst({ where: { id: companyId }, select: { timezone: true } });
    return companyDay(new Date(), c?.timezone);
  }

  router.get('/hr', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_ALL), async (req, res) => {
    const companyId = req.user!.companyId;
    const start = await companyToday(companyId);
    const end = new Date(start.getTime() + 86400000);
    const last30 = new Date(Date.now() - 30 * 86400000);
    const [totalEmployees, activeEmployees, presentToday, onLeaveToday, pendingLeaves, pendingCorrections, joinersLast30Days, recentActivities] = await Promise.all([
      prisma.employee.count({ where: { companyId, status: { notIn: ['TERMINATED'] } } }).catch(() => 0),
      prisma.employee.count({ where: { companyId, status: { in: ['ACTIVE','ON_NOTICE','ON_LEAVE','ONBOARDING'] } } }).catch(() => 0),
      prisma.attendanceRecord.count({ where: { companyId, date: start, checkInAt: { not: null } } }).catch(() => 0),
      prisma.leaveRequest.count({ where: { companyId, status: 'APPROVED', startDate: { lte: start }, endDate: { gte: start } } }).catch(() => 0),
      prisma.leaveRequest.count({ where: { companyId, status: 'PENDING' } }).catch(() => 0),
      prisma.attendanceCorrection.count({ where: { companyId, status: 'PENDING' } }).catch(() => 0),
      prisma.employee.count({ where: { companyId, OR: [{ joiningDate: { gte: last30 } }, { hireDate: { gte: last30 } }] } }).catch(() => 0),
      prisma.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []),
    ]);
    const absentToday = Math.max(activeEmployees - presentToday - onLeaveToday, 0);
    res.json({ data: { totalEmployees, activeEmployees, presentToday, absentToday, onLeaveToday, pendingApprovals: pendingLeaves + pendingCorrections, joinersLast30Days, recentActivities } });
  });

  router.get('/manager', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_TEAM), async (req, res) => {
    const companyId = req.user!.companyId;
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const start = await companyToday(companyId);
    const team = await prisma.employee.findMany({ where: { companyId, managerId: employeeId }, select: { id: true, firstName: true, lastName: true } }).catch(() => [] as Array<{ id: string; firstName: string; lastName: string }>);
    const teamIds = team.map(t => t.id);
    let present = 0, onLeave = 0, pendingLeaves = 0, pendingCorrections = 0, leaveCalendar: any[] = [];
    try {
      [present, onLeave, pendingLeaves, pendingCorrections, leaveCalendar] = await Promise.all([
        teamIds.length ? prisma.attendanceRecord.count({ where: { companyId, employeeId: { in: teamIds }, date: start, checkInAt: { not: null } } }) : Promise.resolve(0),
        teamIds.length ? prisma.leaveRequest.count({ where: { companyId, employeeId: { in: teamIds }, status: 'APPROVED', startDate: { lte: start }, endDate: { gte: start } } }) : Promise.resolve(0),
        prisma.leaveRequest.count({ where: { companyId, status: 'PENDING', employee: { managerId: employeeId } } as any }).catch(() => 0),
        prisma.attendanceCorrection.count({ where: { companyId, status: 'PENDING', employee: { managerId: employeeId } } as any }).catch(() => 0),
        teamIds.length ? prisma.leaveRequest.findMany({ where: { companyId, employeeId: { in: teamIds }, status: 'APPROVED' }, take: 20, orderBy: { startDate: 'asc' } }) : Promise.resolve([] as any[]),
      ]) as [number, number, number, number, any[]];
    } catch {
      present = 0; onLeave = 0; pendingLeaves = 0; pendingCorrections = 0; leaveCalendar = [];
    }
    res.json({ data: { teamMembers: team.length, teamAttendance: { present, absent: Math.max(team.length - Number(present) - Number(onLeave), 0), onLeave }, pendingApprovals: Number(pendingLeaves) + Number(pendingCorrections), teamLeaveCalendar: leaveCalendar } });
  });

  router.get('/employee', requireAnyPermission(PERMISSIONS.DASHBOARD_READ_SELF), async (req, res) => {
    const companyId = req.user!.companyId;
    const employeeId = req.user!.employeeId;
    if (!employeeId) throw new NotFoundError('Employee profile not found');
    const start = await companyToday(companyId);
    const [profile, todayAttendance, balances, requests, notifications] = await Promise.all([
      prisma.employee.findFirst({ where: { companyId, id: employeeId }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, workEmail: true, status: true, jobTitle: true } }),
      prisma.attendanceRecord.findFirst({ where: { companyId, employeeId, date: start } }),
      prisma.leaveBalance.findMany({ where: { companyId, employeeId, year: start.getUTCFullYear() }, include: { leaveType: true } }).catch(() => []),
      prisma.leaveRequest.findMany({ where: { companyId, employeeId }, orderBy: { createdAt: 'desc' }, take: 10, include: { leaveType: true } }).catch(() => []),
      prisma.notification.findMany({ where: { companyId, userId: req.user!.userId, isRead: false }, orderBy: { createdAt: 'desc' }, take: 10 }).catch(() => []),
    ]);
    let action: 'CHECK_IN'|'CHECK_OUT'|'DONE' = 'CHECK_IN';
    if (todayAttendance?.checkInAt && !todayAttendance?.checkOutAt) action = 'CHECK_OUT';
    if (todayAttendance?.checkInAt && todayAttendance?.checkOutAt) action = 'DONE';
    res.json({ data: { profileSummary: profile, attendanceState: { action, today: todayAttendance }, leaveBalances: balances, leaveRequests: requests, notifications } });
  });

  return router;
}
