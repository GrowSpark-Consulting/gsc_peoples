import { z } from 'zod';

/** SET-004: read-only audit log, filterable by user, record and date (company-local calendar dates). */
export const auditLogQuerySchema = z
  .object({
    actorId: z.string().min(1).max(64).optional(),
    entity: z.string().min(1).max(64).optional(),
    entityId: z.string().min(1).max(64).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogEntrySchema),
  page: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
