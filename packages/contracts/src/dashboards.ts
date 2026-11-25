import { z } from 'zod';

export const hrDashboardResponseSchema = z.object({
  data: z.object({
    totalEmployees: z.number().int(),
    activeEmployees: z.number().int(),
    presentToday: z.number().int(),
    /** PRD DASH-001: non-zero only after the work day has ended; before that people are "not yet in". */
    absentToday: z.number().int(),
    notYetInToday: z.number().int(),
    onLeaveToday: z.number().int(),
    pendingApprovals: z.number().int(),
    joinersLast30Days: z.number().int(),
    joiners: z.array(z.object({ id: z.string(), name: z.string(), employeeNumber: z.string(), joiningDate: z.string() })),
    recentActivities: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const managerDashboardResponseSchema = z.object({
  data: z.object({
    teamMembers: z.number().int(),
    teamAttendance: z.record(z.string(), z.unknown()),
    pendingApprovals: z.number().int(),
    teamLeaveCalendar: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const employeeDashboardResponseSchema = z.object({
  data: z.object({
    profileSummary: z.record(z.string(), z.unknown()).nullable(),
    attendanceState: z.object({ action: z.enum(['CHECK_IN', 'CHECK_OUT', 'DONE']), today: z.record(z.string(), z.unknown()).nullable().optional() }),
    leaveBalances: z.array(z.record(z.string(), z.unknown())),
    leaveRequests: z.array(z.record(z.string(), z.unknown())),
    notifications: z.array(z.record(z.string(), z.unknown())),
  }),
});
