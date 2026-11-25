import { auditLogListResponseSchema, employeeListResponseSchema } from '@gsc/contracts';
import { apiRequest } from '@/lib/api-client';

export const AUDIT_PAGE_SIZE = 25;

export interface AuditFilters {
  actorId?: string;
  entity?: string;
  from?: string;
  to?: string;
  page: number;
}

/** SET-004: read-only audit log, Super Admin only. */
export const listAuditLogs = (f: AuditFilters) =>
  apiRequest('/settings/audit-logs', {
    query: { actorId: f.actorId, entity: f.entity, from: f.from, to: f.to, page: f.page, pageSize: AUDIT_PAGE_SIZE },
    schema: auditLogListResponseSchema,
  });

/** Employees who have no login yet can be linked to a new account from the settings screen. */
export const listEmployeesForInvite = () =>
  apiRequest('/employees', { query: { limit: 100 }, schema: employeeListResponseSchema }).then((r) => r.data);
