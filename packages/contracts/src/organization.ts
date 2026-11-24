import { z } from 'zod';

export const designationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Designation = z.infer<typeof designationSchema>;

export const createDesignationSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();
export const updateDesignationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const designationIdParamSchema = z.object({ id: z.uuid() });
export const designationListResponseSchema = z.object({ data: z.array(designationSchema) });

export const orgHolidaySchema = z.object({
  id: z.uuid(),
  date: z.string(),
  name: z.string(),
  isActive: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrgHoliday = z.infer<typeof orgHolidaySchema>;

export const createOrgHolidaySchema = z.object({
  date: z.iso.date(),
  name: z.string().trim().min(1).max(200),
}).strict();
export const updateOrgHolidaySchema = z.object({
  date: z.iso.date().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const orgHolidayIdParamSchema = z.object({ id: z.uuid() });
export const orgHolidayListQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  date: z.iso.date().optional(),
}).strict();
export const holidayListResponseSchema = z.object({ data: z.array(orgHolidaySchema) });

export const departmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
}).strict();
export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });
export const departmentIdParamSchema = z.object({ id: z.uuid() });
export const departmentResponseSchema = z.object({ data: departmentSchema });
export const departmentDetailListResponseSchema = z.object({ data: z.array(departmentSchema) });

export const organizationHierarchyNodeSchema: z.ZodType<any> = z.lazy(() => z.object({
  id: z.uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  jobTitle: z.string().nullable().optional(),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable().optional(),
  reports: z.array(organizationHierarchyNodeSchema),
}));
export const organizationHierarchyResponseSchema = z.object({ data: z.array(organizationHierarchyNodeSchema) });
