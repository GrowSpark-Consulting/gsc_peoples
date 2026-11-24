import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  createOnboardingTaskSchema,
  createOnboardingTemplateTaskSchema,
  updateOnboardingTaskSchema,
  updateOnboardingTemplateTaskSchema,
} from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import type { TenantRunner } from '../../database/tenant';

export function createOnboardingRouter(prisma: PrismaClient, tenantRunner: TenantRunner): Router {
  const router = Router();
  const ctx = (req: any) => ({ companyId: req.user.companyId as string });
  const run = tenantRunner;

  // Templates (HR/SA)
  router.get('/templates', requireAnyPermission(PERMISSIONS.ONBOARDING_WRITE, PERMISSIONS.ONBOARDING_READ_ALL), async (req, res) => {
    const data = await run(ctx(req), async (db: any) => db.onboardingTemplateTask.findMany({ orderBy: { createdAt: 'asc' } }));
    res.json({ data });
  });
  router.post('/templates', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ body: createOnboardingTemplateTaskSchema }), async (req, res) => {
    const data = await run(ctx(req), async (db: any) => db.onboardingTemplateTask.create({ data: req.body }));
    res.status(201).json({ data });
  });
  router.patch('/templates/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }), body: updateOnboardingTemplateTaskSchema }), async (req, res) => {
    const id = (req.params as any).id;
    const data = await run(ctx(req), async (db: any) => {
      const existing = await db.onboardingTemplateTask.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Template task not found');
      return db.onboardingTemplateTask.update({ where: { id }, data: req.body });
    });
    res.json({ data });
  });
  router.delete('/templates/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
    const id = (req.params as any).id;
    await run(ctx(req), async (db: any) => {
      const d = await db.onboardingTemplateTask.deleteMany({ where: { id } });
      if (!d.count) throw new NotFoundError('Template task not found');
    });
    res.status(204).send();
  });

  function progress(tasks: any[]) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const remaining = total - completed;
    const percentage = total ? Math.round((completed / total) * 100) : 100;
    const status = total === 0 || completed === 0 ? 'NOT_STARTED' : completed === total ? 'COMPLETED' : 'IN_PROGRESS';
    return { total, completed, remaining, percentage, status };
  }

  // Tasks for an employee (employee can see own; HR/manager with access can see per scope)
  router.get('/employees/:employeeId/tasks', requireAnyPermission(PERMISSIONS.ONBOARDING_READ_ALL, PERMISSIONS.ONBOARDING_READ_SELF, PERMISSIONS.EMPLOYEE_READ_ALL, PERMISSIONS.EMPLOYEE_READ_TEAM), async (req, res) => {
    const employeeId = (req.params as any).employeeId;
    const data = await run(ctx(req), async (db: any) => {
      const emp = await db.employee.findFirst({ where: { id: employeeId }, select: { id: true, managerId: true } });
      if (!emp) throw new NotFoundError('Employee not found');
      const isSelf = req.user!.employeeId === employeeId;
      const isMgr = req.user!.employeeId && emp.managerId === req.user!.employeeId;
      const canAll = req.user!.permissions.includes(PERMISSIONS.ONBOARDING_READ_ALL) || req.user!.permissions.includes(PERMISSIONS.EMPLOYEE_READ_ALL);
      if (!canAll && !isSelf && !(isMgr && req.user!.permissions.includes(PERMISSIONS.EMPLOYEE_READ_TEAM))) throw new ForbiddenError();
      return db.onboardingTask.findMany({ where: { employeeId }, orderBy: [{ completed: 'asc' }, { createdAt: 'asc' }] });
    });
    res.json({ data, progress: progress(data) });
  });

  router.post('/employees/:employeeId/tasks', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ employeeId: z.string().uuid() }), body: createOnboardingTaskSchema }), async (req, res) => {
    const employeeId = (req.params as any).employeeId;
    const data = await run(ctx(req), async (db: any) => {
      const emp = await db.employee.findFirst({ where: { id: employeeId }, select: { id: true } });
      if (!emp) throw new NotFoundError('Employee not found');
      return db.onboardingTask.create({ data: { employeeId, title: req.body.title, dueDate: req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : null, assigneeType: req.body.assigneeType, assigneeEmployeeId: req.body.assigneeEmployeeId ?? null } });
    });
    const tasks = await run(ctx(req), async (db: any) => db.onboardingTask.findMany({ where: { employeeId } }));
    res.status(201).json({ data, progress: progress(tasks) });
  });

  router.patch('/tasks/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }), body: updateOnboardingTaskSchema }), async (req, res) => {
    const id = (req.params as any).id;
    const data = await run(ctx(req), async (db: any) => {
      const existing = await db.onboardingTask.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Task not found');
      return db.onboardingTask.update({ where: { id }, data: { title: req.body.title, dueDate: req.body.dueDate === null ? null : req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : undefined, assigneeType: req.body.assigneeType, assigneeEmployeeId: req.body.assigneeEmployeeId } });
    });
    res.json({ data });
  });

  router.patch('/tasks/:id/complete', requireAnyPermission(PERMISSIONS.ONBOARDING_TASK_COMPLETE, PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
    const id = (req.params as any).id;
    const result = await run(ctx(req), async (db: any) => {
      const task = await db.onboardingTask.findFirst({ where: { id } });
      if (!task) throw new NotFoundError('Task not found');
      const emp = await db.employee.findFirst({ where: { id: task.employeeId }, select: { id: true, managerId: true } });
      const isSelf = req.user!.employeeId === task.employeeId;
      const isMgr = req.user!.employeeId && emp?.managerId === req.user!.employeeId;
      const canAll = req.user!.permissions.includes(PERMISSIONS.ONBOARDING_WRITE);
      if (!canAll && !isSelf && !isMgr) throw new ForbiddenError();
      if (task.completed) return task;
      return db.onboardingTask.update({ where: { id }, data: { completed: true, completedAt: new Date(), completedByUserId: req.user!.userId } });
    });
    const tasks = await run(ctx(req), async (db: any) => db.onboardingTask.findMany({ where: { employeeId: result.employeeId } }));
    res.json({ data: result, progress: progress(tasks) });
  });

  return router;
}
