/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows (database/tenant/tenant-db.ts) */
import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  can,
  createOnboardingTaskSchema,
  createOnboardingTemplateTaskSchema,
  onboardingProgressListQuerySchema,
  updateOnboardingTaskSchema,
  updateOnboardingTemplateTaskSchema,
} from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission, toAuthzUser } from '../../middleware/authorization/authorize';
import { ForbiddenError, NotFoundError } from '../../shared/errors';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { recordAudit } from '../audit/audit';
import { hrUserIds, notify, userIdForEmployee } from '../notifications/notify';

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
    const data = await run(ctx(req), async (db: any) => {
      const row = await db.onboardingTemplateTask.create({ data: req.body });
      await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.template_created', entity: 'OnboardingTemplateTask', entityId: row.id, newValue: req.body });
      return row;
    });
    res.status(201).json({ data });
  });
  router.patch('/templates/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }), body: updateOnboardingTemplateTaskSchema }), async (req, res) => {
    const id = (req.params as any).id;
    const data = await run(ctx(req), async (db: any) => {
      const existing = await db.onboardingTemplateTask.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Template task not found');
      const row = await db.onboardingTemplateTask.update({ where: { id }, data: req.body });
      await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.template_updated', entity: 'OnboardingTemplateTask', entityId: id, oldValue: existing, newValue: req.body });
      return row;
    });
    res.json({ data });
  });
  router.delete('/templates/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
    const id = (req.params as any).id;
    await run(ctx(req), async (db: any) => {
      const existing = await db.onboardingTemplateTask.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Template task not found');
      await db.onboardingTemplateTask.deleteMany({ where: { id } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.template_deleted', entity: 'OnboardingTemplateTask', entityId: id, oldValue: existing });
    });
    res.status(204).send();
  });

  function progress(tasks: any[]) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const remaining = total - completed;
    const percentage = total ? Math.round((completed / total) * 100) : 0;
    const status = total === 0 || completed === 0 ? ('NOT_STARTED' as const) : completed === total ? ('COMPLETED' as const) : ('IN_PROGRESS' as const);
    return { total, completed, remaining, percentage, status };
  }

  /** NOTIF-002: the assignee of a task is told (the employee, or HR for HR tasks). */
  async function notifyAssigned(db: TenantDb, actorUserId: string, task: { id: string; title: string; assigneeType: string; employeeId: string }) {
    const recipients = task.assigneeType === 'EMPLOYEE' ? [await userIdForEmployee(db, task.employeeId)] : await hrUserIds(db);
    await notify(db, { type: 'ONBOARDING_TASK_ASSIGNED', eventKey: `${task.id}:${task.assigneeType}`, recipients, actorUserId, title: `Onboarding task assigned: ${task.title}`, link: '/onboarding' });
  }

  // ONB-004 / ONB-005: onboarding status and invite state for every employee who is onboarding or has a checklist.
  router.get('/progress', requirePermission(PERMISSIONS.ONBOARDING_READ_ALL), validate({ query: onboardingProgressListQuerySchema }), async (req, res) => {
    const q = req.query as unknown as z.infer<typeof onboardingProgressListQuerySchema>;
    const rows = await run(ctx(req), async (db: any) => {
      const and: any[] = [{ status: { notIn: ['INACTIVE', 'TERMINATED'] } }, { OR: [{ status: 'ONBOARDING' }, { onboardingTasks: { some: {} } }] }];
      if (q.search) {
        for (const token of q.search.split(/\s+/).filter(Boolean)) {
          const c = { contains: token.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' };
          and.push({ OR: [{ firstName: c }, { lastName: c }, { employeeNumber: c }] });
        }
      }
      const employees = await db.employee.findMany({
        where: { AND: and },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true, membership: { select: { status: true } }, onboardingTasks: { select: { completed: true } } },
      });
      return (employees as any[]).map((e) => ({
        employeeId: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeStatus: e.status,
        invitationStatus: e.membership?.status === 'ACTIVE' ? 'ACTIVATED' : e.membership?.status === 'INVITED' ? 'INVITED' : 'NOT_INVITED',
        progress: progress(e.onboardingTasks),
      }));
    });
    // The status is derived from the tasks (not stored), so it is filtered after derivation, then paginated.
    const matching = q.status ? rows.filter((r: { progress: { status: string } }) => r.progress.status === q.status) : rows;
    const start = (q.page - 1) * q.pageSize;
    res.json({ data: matching.slice(start, start + q.pageSize), page: { page: q.page, pageSize: q.pageSize, total: matching.length } });
  });

  // One employee's checklist: HR Admin and Super Admin for anyone, everyone else only their own (PRD section 5:
  // Managers have no onboarding access).
  router.get('/employees/:employeeId/tasks', requireAnyPermission(PERMISSIONS.ONBOARDING_READ_ALL, PERMISSIONS.ONBOARDING_READ_SELF), validate({ params: z.object({ employeeId: z.string().uuid() }) }), async (req, res) => {
    const employeeId = String(req.params.employeeId);
    const data = await run(ctx(req), async (db: any) => {
      if (!req.user!.permissions.includes(PERMISSIONS.ONBOARDING_READ_ALL) && req.user!.employeeId !== employeeId) throw new ForbiddenError();
      const emp = await db.employee.findFirst({ where: { id: employeeId }, select: { id: true } });
      if (!emp) throw new NotFoundError('Employee not found');
      return db.onboardingTask.findMany({ where: { employeeId }, orderBy: [{ completed: 'asc' }, { createdAt: 'asc' }] });
    });
    res.json({ data, progress: progress(data) });
  });

  router.post('/employees/:employeeId/tasks', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ employeeId: z.string().uuid() }), body: createOnboardingTaskSchema }), async (req, res) => {
    const employeeId = (req.params as any).employeeId;
    const data = await run(ctx(req), async (db: any) => {
      const emp = await db.employee.findFirst({ where: { id: employeeId }, select: { id: true } });
      if (!emp) throw new NotFoundError('Employee not found');
      const task = await db.onboardingTask.create({ data: { employeeId, title: req.body.title, dueDate: req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : null, assigneeType: req.body.assigneeType, assigneeEmployeeId: req.body.assigneeEmployeeId ?? null } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.task_created', entity: 'OnboardingTask', entityId: task.id, newValue: { employeeId, title: task.title, assigneeType: task.assigneeType } });
      await notifyAssigned(db, req.user!.userId, task);
      return task;
    });
    const tasks = await run(ctx(req), async (db: any) => db.onboardingTask.findMany({ where: { employeeId } }));
    res.status(201).json({ data, progress: progress(tasks) });
  });

  router.patch('/tasks/:id', requirePermission(PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }), body: updateOnboardingTaskSchema }), async (req, res) => {
    const id = (req.params as any).id;
    const data = await run(ctx(req), async (db: any) => {
      const existing = await db.onboardingTask.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Task not found');
      const task = await db.onboardingTask.update({ where: { id }, data: { title: req.body.title, dueDate: req.body.dueDate === null ? null : req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : undefined, assigneeType: req.body.assigneeType, assigneeEmployeeId: req.body.assigneeEmployeeId } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.task_updated', entity: 'OnboardingTask', entityId: id, oldValue: { title: existing.title, assigneeType: existing.assigneeType, dueDate: existing.dueDate }, newValue: req.body });
      if (task.assigneeType !== existing.assigneeType && !task.completed) await notifyAssigned(db, req.user!.userId, task);
      return task;
    });
    res.json({ data });
  });

  router.patch('/tasks/:id/complete', requireAnyPermission(PERMISSIONS.ONBOARDING_TASK_COMPLETE, PERMISSIONS.ONBOARDING_WRITE), validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
    const id = String(req.params.id);
    const result = await run(ctx(req), async (db: any) => {
      const task = await db.onboardingTask.findFirst({ where: { id } });
      if (!task) throw new NotFoundError('Task not found');
      // ONB-003: HR completes any task; an employee only their own tasks that are assigned to the employee.
      if (!can(toAuthzUser(req.user!), 'onboarding.completeTask', { ownerEmployeeId: task.employeeId, assigneeType: task.assigneeType })) throw new ForbiddenError();
      const claimed = await db.onboardingTask.updateMany({ where: { id, completed: false }, data: { completed: true, completedAt: new Date(), completedByUserId: req.user!.userId } });
      const tasks = await db.onboardingTask.findMany({ where: { employeeId: task.employeeId } });
      if (claimed.count === 1) {
        await recordAudit(db, { actorId: req.user!.userId, action: 'onboarding.task_completed', entity: 'OnboardingTask', entityId: id, newValue: { employeeId: task.employeeId, title: task.title } });
        const emp = await db.employee.findFirst({ where: { id: task.employeeId }, select: { firstName: true, lastName: true } });
        const name = `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
        const hr = await hrUserIds(db);
        await notify(db, { type: 'ONBOARDING_TASK_COMPLETED', eventKey: id, recipients: hr, actorUserId: req.user!.userId, title: `${name} · task completed: ${task.title}`, link: '/onboarding' });
        // W3: when everything is done, onboarding is Completed and HR is told.
        if (progress(tasks).status === 'COMPLETED') {
          await notify(db, { type: 'ONBOARDING_COMPLETED', eventKey: task.employeeId, recipients: hr, title: `Onboarding completed for ${name}`, link: `/employees/${task.employeeId}` });
        }
      }
      return { task: await db.onboardingTask.findFirst({ where: { id } }), tasks };
    });
    res.json({ data: result.task, progress: progress(result.tasks) });
  });

  return router;
}
