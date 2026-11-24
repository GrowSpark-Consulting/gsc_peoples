import {
  attendanceListResponseSchema,
  attendanceOverviewResponseSchema,
  manualAttendanceCorrectionResponseSchema,
  type attendanceOverviewStatusSchema,
  type manualAttendanceCorrectionSchema,
  correctionListResponseSchema,
  correctionResponseSchema,
  employeeListResponseSchema,
  type createAttendanceCorrectionSchema,
  type reviewAttendanceCorrectionSchema,
} from '@gsc/contracts';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/** Shape of `GET /attendance/today` as implemented by the API (no shared contract exists for it yet). */
export const todayResponseSchema = z.object({
  data: z.object({
    date: z.string(),
    record: z
      .object({ checkInAt: z.string().nullable(), checkOutAt: z.string().nullable() })
      .passthrough()
      .nullable(),
    state: z.enum(['NOT_CHECKED_IN', 'CHECKED_IN', 'DONE']),
  }),
});

export const getToday = () => apiRequest('/attendance/today', { schema: todayResponseSchema }).then((r) => r.data);
export const checkIn = () => apiRequest('/attendance/check-in', { method: 'POST' });
export const checkOut = () => apiRequest('/attendance/check-out', { method: 'POST' });

export interface HistoryQuery {
  employeeId?: string;
  month: number;
  year: number;
  page: number;
}
export const PAGE_SIZE = 25;
export const getHistory = (q: HistoryQuery) =>
  apiRequest('/attendance/history', {
    query: { employeeId: q.employeeId, month: q.month, year: q.year, page: q.page, pageSize: PAGE_SIZE },
    schema: attendanceListResponseSchema,
  });

export const listCorrections = () =>
  apiRequest('/attendance/corrections', { schema: correctionListResponseSchema }).then((r) => r.data);
export const requestCorrection = (body: z.input<typeof createAttendanceCorrectionSchema>) =>
  apiRequest('/attendance/corrections', { method: 'POST', body, schema: correctionResponseSchema });
export const reviewCorrection = (id: string, body: z.input<typeof reviewAttendanceCorrectionSchema>) =>
  apiRequest(`/attendance/corrections/${encodeURIComponent(id)}/review`, {
    method: 'PATCH',
    body,
    schema: correctionResponseSchema,
  });

/** Names for pickers and tables. The API narrows the list to what the caller may see (all, team or self). */
export const getEmployeeNames = () =>
  apiRequest('/employees', { query: { limit: 100 }, schema: employeeListResponseSchema }).then((r) =>
    r.data.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })),
  );

/** ATT-004: HR attendance overview for one date (HR Admin and Super Admin only). */
export interface OverviewQuery {
  date: string;
  status?: z.infer<typeof attendanceOverviewStatusSchema>;
  page: number;
}
export const OVERVIEW_PAGE_SIZE = 25;
export const getOverview = (q: OverviewQuery) =>
  apiRequest('/attendance/overview', {
    query: { date: q.date, status: q.status, page: q.page, pageSize: OVERVIEW_PAGE_SIZE },
    schema: attendanceOverviewResponseSchema,
  });

/** ATT-007: HR manual correction. */
export const submitManualCorrection = (body: z.input<typeof manualAttendanceCorrectionSchema>) =>
  apiRequest('/attendance/manual-corrections', { method: 'POST', body, schema: manualAttendanceCorrectionResponseSchema });
