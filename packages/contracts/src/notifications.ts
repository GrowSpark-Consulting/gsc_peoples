import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  message: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  isRead: z.boolean(),
  createdAt: z.string(),
  readAt: z.string().nullable().optional(),
});
export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  unreadOnly: z.coerce.boolean().optional(),
}).strict();
export const notificationListResponseSchema = z.object({
  data: z.array(notificationSchema),
  unreadCount: z.number().int(),
  page: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
export const markNotificationsReadSchema = z.object({ all: z.boolean().optional() }).strict();
