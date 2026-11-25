import {
  designationListResponseSchema,
  directoryResponseSchema,
  employeeResponseSchema,
  employeeTimelineResponseSchema,
  type employeeSelfUpdateSchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Endpoints around one employee record that only exist on the real API (not in the development demo adapter):
 * activity timeline (EMP-008), own contact details (EMP-009), invitation (AUTH-004) and designations.
 */
const enc = encodeURIComponent;

export const getTimeline = (id: string) =>
  apiRequest(`/employees/${enc(id)}/timeline`, { schema: employeeTimelineResponseSchema }).then((r) => r.data);

export const updateMyContact = (body: z.input<typeof employeeSelfUpdateSchema>) =>
  apiRequest('/employees/me', { method: 'PATCH', body, schema: employeeResponseSchema }).then((r) => r.data);

export const inviteFromRecord = (id: string, roleKey: 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN') =>
  apiRequest(`/employees/${enc(id)}/invite`, { method: 'POST', body: { roleKey } });

export const listDesignationOptions = () =>
  apiRequest('/organization/designations', { schema: designationListResponseSchema }).then((r) => r.data.filter((d) => d.isActive));

export const getDirectory = (q: { q?: string; page: number; pageSize: number }) =>
  apiRequest('/employees/directory', { query: { q: q.q, page: q.page, pageSize: q.pageSize }, schema: directoryResponseSchema });
