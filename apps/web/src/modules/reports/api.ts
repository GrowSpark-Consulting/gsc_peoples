import { attendanceReportResponseSchema } from '@gsc/contracts';
import { publicEnv } from '@/config/env';
import { apiRequest } from '@/lib/api-client';
import { ApiError } from '@/modules/employees/errors';

export const REPORT_PAGE_SIZE = 25;

export interface ReportFilters {
  year: number;
  month: number;
  departmentId?: string;
}

/** ATT-008: monthly attendance report (HR Admin and Super Admin). */
export const getAttendanceReport = (f: ReportFilters, page: number) =>
  apiRequest('/attendance/report', {
    query: { year: f.year, month: f.month, departmentId: f.departmentId, page, pageSize: REPORT_PAGE_SIZE },
    schema: attendanceReportResponseSchema,
  });

/** The CSV covers every matching employee, not only the visible page. */
export async function downloadAttendanceCsv(f: ReportFilters): Promise<{ blob: Blob; fileName: string }> {
  const query = new URLSearchParams({ year: String(f.year), month: String(f.month), format: 'csv' });
  if (f.departmentId) query.set('departmentId', f.departmentId);
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl.replace(/\/+$/, '')}/attendance/report?${query}`, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }
  if (res.status === 401) window.location.replace('/login');
  if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  return { blob: await res.blob(), fileName: `attendance-${f.year}-${String(f.month).padStart(2, '0')}.csv` };
}
