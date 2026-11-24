import {
  departmentDetailListResponseSchema,
  designationListResponseSchema,
  holidayListResponseSchema,
  organizationHierarchyResponseSchema,
  type createDepartmentSchema,
  type createDesignationSchema,
  type createOrgHolidaySchema,
  type updateDepartmentSchema,
  type updateDesignationSchema,
  type updateOrgHolidaySchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

const enc = encodeURIComponent;

export const listDepartments = () =>
  apiRequest('/organization/departments', { schema: departmentDetailListResponseSchema }).then((r) => r.data);
export const createDepartment = (body: z.input<typeof createDepartmentSchema>) =>
  apiRequest('/organization/departments', { method: 'POST', body });
export const updateDepartment = (id: string, body: z.input<typeof updateDepartmentSchema>) =>
  apiRequest(`/organization/departments/${enc(id)}`, { method: 'PATCH', body });
export const deleteDepartment = (id: string) => apiRequest(`/organization/departments/${enc(id)}`, { method: 'DELETE' });

export const listDesignations = () =>
  apiRequest('/organization/designations', { schema: designationListResponseSchema }).then((r) => r.data);
export const createDesignation = (body: z.input<typeof createDesignationSchema>) =>
  apiRequest('/organization/designations', { method: 'POST', body });
export const updateDesignation = (id: string, body: z.input<typeof updateDesignationSchema>) =>
  apiRequest(`/organization/designations/${enc(id)}`, { method: 'PATCH', body });
export const deleteDesignation = (id: string) => apiRequest(`/organization/designations/${enc(id)}`, { method: 'DELETE' });

export const listHolidays = (year: number) =>
  apiRequest('/organization/holidays', { query: { year }, schema: holidayListResponseSchema }).then((r) => r.data);
export const createHoliday = (body: z.input<typeof createOrgHolidaySchema>) =>
  apiRequest('/organization/holidays', { method: 'POST', body });
export const updateHoliday = (id: string, body: z.input<typeof updateOrgHolidaySchema>) =>
  apiRequest(`/organization/holidays/${enc(id)}`, { method: 'PATCH', body });
export const deleteHoliday = (id: string) => apiRequest(`/organization/holidays/${enc(id)}`, { method: 'DELETE' });

export const getHierarchy = () =>
  apiRequest('/organization/hierarchy', { schema: organizationHierarchyResponseSchema }).then((r) => r.data);
