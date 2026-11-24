import { z } from 'zod';

export const onboardingAssigneeTypeSchema = z.enum(['HR', 'EMPLOYEE']);
export const onboardingStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);

export const onboardingTaskSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  title: z.string(),
  dueDate: z.string().nullable(),
  assigneeType: onboardingAssigneeTypeSchema,
  assigneeEmployeeId: z.uuid().nullable().optional(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const onboardingProgressSchema = z.object({
  total: z.number().int(),
  completed: z.number().int(),
  remaining: z.number().int(),
  percentage: z.number(),
  status: onboardingStatusSchema,
});

export const createOnboardingTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: z.iso.date().nullish(),
  assigneeType: onboardingAssigneeTypeSchema,
  assigneeEmployeeId: z.uuid().nullish(),
}).strict();
export const updateOnboardingTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dueDate: z.iso.date().nullable().optional(),
  assigneeType: onboardingAssigneeTypeSchema.optional(),
  assigneeEmployeeId: z.uuid().nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const onboardingTaskIdParamSchema = z.object({ id: z.uuid(), taskId: z.uuid().optional() });
export const onboardingListResponseSchema = z.object({ data: z.array(onboardingTaskSchema), progress: onboardingProgressSchema.optional() });
export const onboardingTaskResponseSchema = z.object({ data: onboardingTaskSchema, progress: onboardingProgressSchema.optional() });

export const onboardingTemplateTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  dueOffsetDays: z.number().int().nullable().optional(),
  assigneeType: onboardingAssigneeTypeSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createOnboardingTemplateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueOffsetDays: z.number().int().min(0).max(365).nullish(),
  assigneeType: onboardingAssigneeTypeSchema,
  isActive: z.boolean().optional(),
}).strict();
export const updateOnboardingTemplateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  dueOffsetDays: z.number().int().min(0).max(365).nullable().optional(),
  assigneeType: onboardingAssigneeTypeSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const onboardingTemplateListResponseSchema = z.object({ data: z.array(onboardingTemplateTaskSchema) });
