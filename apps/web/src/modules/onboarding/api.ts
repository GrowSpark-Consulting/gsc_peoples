import {
  onboardingListResponseSchema,
  onboardingProgressListResponseSchema,
  type onboardingStatusSchema,
  onboardingTemplateListResponseSchema,
  type createOnboardingTaskSchema,
  type createOnboardingTemplateTaskSchema,
  type updateOnboardingTaskSchema,
  type updateOnboardingTemplateTaskSchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

const enc = encodeURIComponent;

export const PAGE_SIZE = 25;
export interface ProgressQuery {
  status?: z.infer<typeof onboardingStatusSchema>;
  search?: string;
  page: number;
}
/** ONB-004 / ONB-005: onboarding status and invite state per employee, filtered and paginated by the API. */
export const listOnboardingProgress = (q: ProgressQuery) =>
  apiRequest('/onboarding/progress', {
    query: { status: q.status, search: q.search, page: q.page, pageSize: PAGE_SIZE },
    schema: onboardingProgressListResponseSchema,
  });

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
