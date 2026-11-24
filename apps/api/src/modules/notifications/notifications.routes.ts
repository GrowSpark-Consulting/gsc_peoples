import { Router } from 'express';
import { notificationListQuerySchema, PERMISSIONS } from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import { validate } from '../../middleware/validation/validate';
import { requirePermission } from '../../middleware/authorization/authorize';
import { NotFoundError } from '../../shared/errors';

export function createNotificationsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/', requirePermission(PERMISSIONS.NOTIFICATION_READ_SELF), validate({ query: notificationListQuerySchema }), async (req, res) => {
    const q = req.query as any;
    const companyId = req.user!.companyId;
    const userId = req.user!.userId;
    const where: any = { companyId, userId };
    if (q.unreadOnly) where.isRead = false;
    const [data, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { companyId, userId, isRead: false } }),
    ]);
    res.json({ data, unreadCount, page: { page: q.page, pageSize: q.pageSize, total } });
  });
  router.patch('/:id/read', requirePermission(PERMISSIONS.NOTIFICATION_WRITE_SELF), async (req, res) => {
    const id = String(req.params.id);
    const updated = await prisma.notification.updateMany({ where: { id, companyId: req.user!.companyId, userId: req.user!.userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    if (updated.count === 0) {
      const exists = await prisma.notification.findFirst({ where: { id, companyId: req.user!.companyId, userId: req.user!.userId }, select: { id: true } });
      if (!exists) throw new NotFoundError('Notification not found');
    }
    const row = await prisma.notification.findFirst({ where: { id, companyId: req.user!.companyId, userId: req.user!.userId } });
    res.json({ data: row });
  });
  router.patch('/read-all', requirePermission(PERMISSIONS.NOTIFICATION_WRITE_SELF), async (req, res) => {
    await prisma.notification.updateMany({ where: { companyId: req.user!.companyId, userId: req.user!.userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    res.json({ data: { ok: true } });
  });
  return router;
}
