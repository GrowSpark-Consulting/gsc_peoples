import { z } from 'zod';

/** Standard error body returned by every API endpoint. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Dependency state reported by the health endpoints. */
export const dependencyStatusSchema = z.enum(['up', 'down', 'not_configured']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('gsc-peoples-api'),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
  dependencies: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
