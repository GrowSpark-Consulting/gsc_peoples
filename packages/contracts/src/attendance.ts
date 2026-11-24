import { z } from 'zod';

export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'NOT_YET_IN', 'MISSING_CHECKOUT']);
export const correctionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const attendanceRecordSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  date: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  workedMinutes: z.number().int().nullable(),
  workedHours: z.number().nullable(),
  status: attendanceStatusSchema.optional(),
  isWeekend: z.boolean().optional(),
  isHoliday: z.boolean().optional(),
  holidayName: z.string().nullable().optional(),
  hasApprovedLeave: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const attendanceHistoryQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const attendanceSummarySchema = z.object({
  present: z.number().int(),
  absent: z.number().int(),
  onLeave: z.number().int(),
  holidays: z.number().int(),
  hoursWorked: z.number(),
});
export const attendanceSummaryResponseSchema = z.object({ data: attendanceSummarySchema, records: z.array(attendanceRecordSchema).optional() });
export const attendanceListResponseSchema = z.object({ data: z.array(attendanceRecordSchema), page: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }).optional(), summary: attendanceSummarySchema.optional() });

export const attendanceCorrectionSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  date: z.string(),
  proposedCheckInAt: z.string(),
  proposedCheckOutAt: z.string(),
  reason: z.string(),
  status: correctionStatusSchema,
  reviewerComment: z.string().nullable().optional(),
  originalCheckInAt: z.string().nullable().optional(),
  originalCheckOutAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createAttendanceCorrectionSchema = z.object({
  date: z.iso.date(),
  proposedCheckInAt: z.string().datetime(),
  proposedCheckOutAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export const reviewAttendanceCorrectionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(1000).optional(),
}).strict().refine((v) => v.status === 'APPROVED' || Boolean(v.comment?.trim()), { message: 'Rejection requires a comment', path: ['comment'] });
export const manualAttendanceCorrectionSchema = z.object({
  employeeId: z.uuid(),
  date: z.iso.date(),
  checkInAt: z.string().datetime().nullable().optional(),
  checkOutAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export const correctionListResponseSchema = z.object({ data: z.array(attendanceCorrectionSchema) });
export const correctionResponseSchema = z.object({ data: attendanceCorrectionSchema });

// ATT-007 / ATT-004 -----------------------------------------------------------------------------------------

/** Overview statuses (ATT-004). WEEKEND covers any non-working day of the company calendar. */
export const attendanceOverviewStatusSchema = z.enum(['PRESENT', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND', 'NOT_YET_IN', 'MISSING_CHECKOUT']);

export const attendanceOverviewQuerySchema = z.object({
  date: z.iso.date(),
  departmentId: z.uuid().optional(),
  status: attendanceOverviewStatusSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const attendanceOverviewRowSchema = z.object({
  employeeId: z.uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  status: attendanceOverviewStatusSchema,
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  workedMinutes: z.number().int().nullable(),
  /** Set when the employee has approved half-day leave on this date (the day is still a working day). */
  halfDayLeave: z.boolean(),
  holidayName: z.string().nullable(),
  corrected: z.boolean(),
});

export const attendanceOverviewResponseSchema = z.object({
  data: z.array(attendanceOverviewRowSchema),
  page: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
  /** Counts per status over ALL matching employees (not just this page). */
  summary: z.record(attendanceOverviewStatusSchema, z.number().int()),
  meta: z.object({ date: z.string(), isWorkingDay: z.boolean(), isHoliday: z.boolean(), holidayName: z.string().nullable() }),
});

export const manualAttendanceRecordSchema = attendanceRecordSchema.extend({
  originalCheckInAt: z.string().nullable().optional(),
  originalCheckOutAt: z.string().nullable().optional(),
  correctionReason: z.string().nullable().optional(),
  lastCorrectedAt: z.string().nullable().optional(),
  lastCorrectedByUserId: z.string().nullable().optional(),
});
export const manualAttendanceCorrectionResponseSchema = z.object({ data: manualAttendanceRecordSchema });
