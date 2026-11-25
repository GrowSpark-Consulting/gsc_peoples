import { z } from 'zod';

export const leaveRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const leaveDayTypeSchema = z.enum(['FULL_DAY', 'HALF_DAY']);
export const leaveHalfSchema = z.enum(['FIRST_HALF', 'SECOND_HALF']);

export const leaveTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  annualAllocation: z.number(),
  isPaid: z.boolean(),
  allowHalfDay: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  annualAllocation: z.number().min(0).max(366),
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
}).strict();
export const updateLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  annualAllocation: z.number().min(0).max(366).optional(),
  isPaid: z.boolean().optional(),
  allowHalfDay: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const leaveTypeListResponseSchema = z.object({ data: z.array(leaveTypeSchema) });

export const leaveBalanceSchema = z.object({
  id: z.uuid().optional(),
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveTypeName: z.string().optional(),
  year: z.number().int(),
  allocated: z.number(),
  adjusted: z.number(),
  used: z.number(),
  pending: z.number(),
  available: z.number(),
});
export const leaveBalanceListResponseSchema = z.object({ data: z.array(leaveBalanceSchema) });
export const adjustLeaveBalanceSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.number().int().min(2000).max(2100),
  amount: z.number(),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const leaveRequestSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveTypeName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  dayType: leaveDayTypeSchema,
  halfDaySession: leaveHalfSchema.nullable().optional(),
  reason: z.string(),
  days: z.number(),
  status: leaveRequestStatusSchema,
  approverId: z.uuid().nullable().optional(),
  decisionComment: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createLeaveRequestSchema = z.object({
  leaveTypeId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  dayType: leaveDayTypeSchema.default('FULL_DAY'),
  halfDaySession: leaveHalfSchema.nullish(),
  reason: z.string().trim().min(1).max(1000),
}).strict().superRefine((v, ctx) => {
  if (v.dayType === 'HALF_DAY' && v.startDate !== v.endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Half-day leave applies to one date', path: ['endDate'] });
  }
  if (v.dayType === 'HALF_DAY' && !v.halfDaySession) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Half-day session is required', path: ['halfDaySession'] });
  }
  if (v.dayType === 'FULL_DAY' && v.halfDaySession) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Half-day session is only for half-day leave', path: ['halfDaySession'] });
  }
});
export const leaveRequestDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(1000).optional(),
}).strict().refine((v) => v.status === 'APPROVED' || Boolean(v.comment?.trim()), { message: 'Rejection requires a comment', path: ['comment'] });
export const leaveRequestListQuerySchema = z.object({
  status: csvLeaveStatus().optional(),
  employeeId: z.uuid().optional(),
  mine: z.coerce.boolean().optional(),
  team: z.coerce.boolean().optional(),
  pendingForMe: z.coerce.boolean().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

function csvLeaveStatus() {
  return z.preprocess((v) => typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : v, z.array(leaveRequestStatusSchema));
}
export const leaveRequestListResponseSchema = z.object({ data: z.array(leaveRequestSchema), page: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }).optional() });

// LEAVE-008: month calendar -----------------------------------------------------------------------------------

export const leaveCalendarScopeSchema = z.enum(['own', 'team', 'all']);
export type LeaveCalendarScope = z.infer<typeof leaveCalendarScopeSchema>;
export const leaveCalendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  /** Defaults to the widest calendar the caller may see. */
  scope: leaveCalendarScopeSchema.optional(),
}).strict();
export const leaveCalendarDaySchema = z.object({
  date: z.string(),
  isWorkingDay: z.boolean(),
  holidayName: z.string().nullable(),
  items: z.array(z.object({
    requestId: z.uuid(),
    employeeId: z.uuid(),
    employeeName: z.string(),
    leaveTypeName: z.string(),
    status: z.enum(['PENDING', 'APPROVED']),
    dayType: leaveDayTypeSchema,
    halfDaySession: leaveHalfSchema.nullable(),
  })),
});
export const leaveCalendarResponseSchema = z.object({
  data: z.array(leaveCalendarDaySchema),
  meta: z.object({ year: z.number().int(), month: z.number().int(), scope: leaveCalendarScopeSchema }),
});
