import {
  leaveBalanceListResponseSchema,
  leaveCalendarResponseSchema,
  type LeaveCalendarScope,
  leaveRequestListResponseSchema,
  leaveTypeListResponseSchema,
  type adjustLeaveBalanceSchema,
  type createLeaveRequestSchema,
  type createLeaveTypeSchema,
  type leaveRequestDecisionSchema,
  type updateLeaveTypeSchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

export const PAGE_SIZE = 25;

export const listLeaveTypes = () =>
  apiRequest('/leave/types', { schema: leaveTypeListResponseSchema }).then((r) => r.data);
export const createLeaveType = (body: z.input<typeof createLeaveTypeSchema>) =>
  apiRequest('/leave/types', { method: 'POST', body });
export const updateLeaveType = (id: string, body: z.input<typeof updateLeaveTypeSchema>) =>
  apiRequest(`/leave/types/${encodeURIComponent(id)}`, { method: 'PATCH', body });

export const listBalances = (employeeId?: string) =>
  apiRequest('/leave/balances', { query: { employeeId }, schema: leaveBalanceListResponseSchema }).then((r) => r.data);
export const adjustBalance = (body: z.input<typeof adjustLeaveBalanceSchema>) =>
  apiRequest('/leave/balances/adjust', { method: 'POST', body });

export interface RequestFilters {
  /** Restrict to one employee (the caller's own history, or someone they may see). */
  employeeId?: string;
  /** Only requests waiting for the caller's decision. */
  pendingForMe?: boolean;
  status?: readonly string[];
  page: number;
}
export const listRequests = (f: RequestFilters) =>
  apiRequest('/leave/requests', {
    query: {
      employeeId: f.employeeId,
      pendingForMe: f.pendingForMe ? true : undefined,
      status: f.status,
      page: f.page,
      pageSize: PAGE_SIZE,
    },
    schema: leaveRequestListResponseSchema,
  });
export const applyForLeave = (body: z.input<typeof createLeaveRequestSchema>) =>
  apiRequest('/leave/requests', { method: 'POST', body });
export const decideRequest = (id: string, body: z.input<typeof leaveRequestDecisionSchema>) =>
  apiRequest(`/leave/requests/${encodeURIComponent(id)}/review`, { method: 'PATCH', body });
export const cancelRequest = (id: string) =>
  apiRequest(`/leave/requests/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' });

/** LEAVE-008: one month of own, team or company leave with holidays. */
export const getCalendar = (q: { year: number; month: number; scope: LeaveCalendarScope }) =>
  apiRequest('/leave/calendar', { query: { year: q.year, month: q.month, scope: q.scope }, schema: leaveCalendarResponseSchema });
