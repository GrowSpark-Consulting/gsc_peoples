import { z } from 'zod';
import { permissionSchema, ROLE_KEYS } from './permissions';

/** Company configuration the frontend and the attendance/leave modules need (ORG-001, A3). */
export const meCompanySchema = z.object({
  name: z.string(),
  timezone: z.string(), // IANA, e.g. "Asia/Kolkata"; all dates are shown and computed in this zone
  workingDays: z.array(z.number().int().min(1).max(7)), // ISO weekdays, 1 = Monday ... 7 = Sunday
  workStartTime: z.string(), // "HH:mm" company-local
  workEndTime: z.string(), // "HH:mm" company-local
});
export type MeCompany = z.infer<typeof meCompanySchema>;

/**
 * GET /api/v1/me - who the verified caller is, in which company, and what they may do.
 * Derived only from the validated ACTIVE membership (never from request input). The frontend uses
 * it for display and UI gating; the API still enforces every permission itself.
 *
 *  - `role`: the caller's single role in this company (PRD: one role per user per company).
 *  - `roles`: same role as a list (kept for existing consumers).
 *  - `permissions`: from the code-defined role matrix (PRD section 5, SET-003).
 *  - `dashboard`: which dashboard the role lands on (DASH-001..003).
 *  - `company`: timezone, working days and hours of the caller's company.
 */
export const meResponseSchema = z.object({
  data: z.object({
    userId: z.string(),
    employeeId: z.string().nullable(),
    companyId: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    role: z.enum(ROLE_KEYS).nullable().optional(),
    roles: z.array(z.string()),
    permissions: z.array(permissionSchema),
    dashboard: z.enum(['admin', 'manager', 'employee']).nullable().optional(),
    company: meCompanySchema.nullable().optional(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
