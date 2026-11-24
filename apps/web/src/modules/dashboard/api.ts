import {
  employeeDashboardResponseSchema,
  employeeListResponseSchema,
  hrDashboardResponseSchema,
  leaveBalanceListResponseSchema,
  managerDashboardResponseSchema,
} from '@gsc/contracts';
import { apiRequest } from '@/lib/api-client';

export const getHrDashboard = () =>
  apiRequest('/dashboard/hr', { schema: hrDashboardResponseSchema }).then((r) => r.data);
export const getManagerDashboard = () =>
  apiRequest('/dashboard/manager', { schema: managerDashboardResponseSchema }).then((r) => r.data);
export const getEmployeeDashboard = () =>
  apiRequest('/dashboard/employee', { schema: employeeDashboardResponseSchema }).then((r) => r.data);
export const getMyLeaveBalances = () =>
  apiRequest('/leave/balances', { schema: leaveBalanceListResponseSchema }).then((r) => r.data);
/** Names for the team leave list (the dashboard returns employee ids only). */
export const getTeamNames = () =>
  apiRequest('/employees', { query: { limit: 100 }, schema: employeeListResponseSchema }).then(
    (r) => new Map(r.data.map((e) => [e.id, `${e.firstName} ${e.lastName}`] as const)),
  );
export const checkIn = () => apiRequest('/attendance/check-in', { method: 'POST' });
export const checkOut = () => apiRequest('/attendance/check-out', { method: 'POST' });
