import {
  employeeListResponseSchema,
  onboardingListResponseSchema,
  onboardingTemplateListResponseSchema,
  type createOnboardingTaskSchema,
  type createOnboardingTemplateTaskSchema,
  type updateOnboardingTaskSchema,
  type updateOnboardingTemplateTaskSchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

const enc = encodeURIComponent;

/** Employees still onboarding. There is no cross-employee onboarding list endpoint yet (see the matrix, G11). */
export const listOnboardingEmployees = () =>
  apiRequest('/employees', { query: { status: ['ONBOARDING'], limit: 100 }, schema: employeeListResponseSchema }).then(
    (r) => r.data,
  );

export const getChecklist = (employeeId: string) =>
  apiRequest(`/onboarding/employees/${enc(employeeId)}/tasks`, { schema: onboardingListResponseSchema });
export const addTask = (employeeId: string, body: z.input<typeof createOnboardingTaskSchema>) =>
  apiRequest(`/onboarding/employees/${enc(employeeId)}/tasks`, { method: 'POST', body });
export const updateTask = (id: string, body: z.input<typeof updateOnboardingTaskSchema>) =>
  apiRequest(`/onboarding/tasks/${enc(id)}`, { method: 'PATCH', body });
export const completeTask = (id: string) => apiRequest(`/onboarding/tasks/${enc(id)}/complete`, { method: 'PATCH' });
export const inviteEmployee = (employeeId: string) =>
  apiRequest(`/employees/${enc(employeeId)}/invite`, { method: 'POST' });

export const listTemplate = () =>
  apiRequest('/onboarding/templates', { schema: onboardingTemplateListResponseSchema }).then((r) => r.data);
export const createTemplateTask = (body: z.input<typeof createOnboardingTemplateTaskSchema>) =>
  apiRequest('/onboarding/templates', { method: 'POST', body });
export const updateTemplateTask = (id: string, body: z.input<typeof updateOnboardingTemplateTaskSchema>) =>
  apiRequest(`/onboarding/templates/${enc(id)}`, { method: 'PATCH', body });
export const deleteTemplateTask = (id: string) => apiRequest(`/onboarding/templates/${enc(id)}`, { method: 'DELETE' });
