import { Router } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  createDepartmentSchema,
  createDesignationSchema,
  createOrgHolidaySchema,
  departmentIdParamSchema,
  designationIdParamSchema,
  orgHolidayIdParamSchema,
  orgHolidayListQuerySchema,
  updateDepartmentSchema,
  updateDesignationSchema,
  updateOrgHolidaySchema,
} from '@gsc/contracts';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { validate } from '../../middleware/validation/validate';
import { UnauthorizedError, ValidationError, NotFoundError } from '../../shared/errors';
import type { PrismaClient } from '../../database/generated/client';
import { withTenant, type TenantRunner } from '../../database/tenant';

export function createOrganizationRouter(prisma: PrismaClient, tenantRunner: TenantRunner): Router {
  const router = Router();
  const run = tenantRunner;
  const ctx = (req: any) => ({ companyId: req.user.companyId as string });
  const canReadOrg = requireAnyPermission(PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.EMPLOYEE_READ_ALL, PERMISSIONS.EMPLOYEE_READ_TEAM, PERMISSIONS.EMPLOYEE_READ_SELF);

  // Departments
  router.get('/departments', canReadOrg, async (req, res) => {
    const data = await run(ctx(req), async (db: any) => db.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, description: true, isActive: true, createdAt: true, updatedAt: true } }));
    res.json({ data });
  });
  router.post('/departments', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ body: createDepartmentSchema }), async (req, res) => {
    try {
      const row = await run(ctx(req), async (db: any) => db.department.create({ data: { name: req.body.name, description: req.body.description ?? null }, select: { id: true, name: true, description: true, isActive: true, createdAt: true, updatedAt: true } }));
      await prisma.auditLog.create({ data: { companyId: req.user!.companyId, actorId: req.user!.userId, action: 'department.created', entity: 'Department', entityId: row.id, newValue: { name: row.name } } });
      res.status(201).json({ data: row });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Department name must be unique');
      throw e;
    }
  });
  router.patch('/departments/:id', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ params: departmentIdParamSchema, body: updateDepartmentSchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    try {
      const row = await run(ctx(req), async (db: any) => {
        const existing = await db.department.findFirst({ where: { id } });
        if (!existing) throw new NotFoundError('Department not found');
        if (req.body.isActive === false) {
          // archive allowed even if active employees exist? PRD says "Do not delete departments that have active employees" but archive may be allowed; be safe and block if has active employees.
          const activeCount = await db.employee.count({ where: { departmentId: id, status: { in: ['ONBOARDING','ACTIVE','ON_LEAVE','ON_NOTICE'] } } });
          if (activeCount > 0) throw new ValidationError('Cannot archive a department with active employees');
        }
        return db.department.update({ where: { id }, data: { name: req.body.name, description: req.body.description, isActive: req.body.isActive }, select: { id: true, name: true, description: true, isActive: true, createdAt: true, updatedAt: true } });
      });
      res.json({ data: row });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Department name must be unique');
      throw e;
    }
  });
  router.delete('/departments/:id', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ params: departmentIdParamSchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    await run(ctx(req), async (db: any) => {
      const count = await db.employee.count({ where: { departmentId: id } });
      if (count > 0) throw new ValidationError('Cannot delete a department that has employees; archive it instead');
      const deleted = await db.department.deleteMany({ where: { id } });
      if (deleted.count === 0) throw new NotFoundError('Department not found');
    });
    res.status(204).send();
  });

  // Designations
  router.get('/designations', canReadOrg, async (req, res) => {
    const data = await run(ctx(req), async (db: any) => db.designation.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true } }));
    res.json({ data });
  });
  router.post('/designations', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ body: createDesignationSchema }), async (req, res) => {
    try {
      const row = await run(ctx(req), async (db: any) => db.designation.create({ data: { name: req.body.name }, select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true } }));
      res.status(201).json({ data: row });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Designation name must be unique');
      throw e;
    }
  });
  router.patch('/designations/:id', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ params: designationIdParamSchema, body: updateDesignationSchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    try {
      const row = await run(ctx(req), async (db: any) => {
        const existing = await db.designation.findFirst({ where: { id } });
        if (!existing) throw new NotFoundError('Designation not found');
        if (req.body.isActive === false) {
          // "Do not delete designations that are in use" - archive allowed? safe to allow archive.
        }
        return db.designation.update({ where: { id }, data: { name: req.body.name, isActive: req.body.isActive }, select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
      });
      res.json({ data: row });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('Designation name must be unique');
      throw e;
    }
  });
  router.delete('/designations/:id', requirePermission(PERMISSIONS.ORGANIZATION_WRITE), validate({ params: designationIdParamSchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    await run(ctx(req), async (db: any) => {
      const count = await db.employee.count({ where: { designationId: id } });
      if (count > 0) throw new ValidationError('Cannot delete a designation that is in use; archive it instead');
      const deleted = await db.designation.deleteMany({ where: { id } });
      if (deleted.count === 0) throw new NotFoundError('Designation not found');
    });
    res.status(204).send();
  });

  // Holidays
  router.get('/holidays', canReadOrg, validate({ query: orgHolidayListQuerySchema }), async (req, res) => {
    const q = req.query as any;
    const data = await run(ctx(req), async (db: any) => {
      const where: any = { isActive: true };
      if (q.date) where.date = new Date(`${q.date}T00:00:00.000Z`);
      if (q.year || q.month) {
        const year = Number(q.year ?? new Date().getUTCFullYear());
        const month = q.month ? Number(q.month) - 1 : 0;
        const start = q.month ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year, 0, 1));
        const end = q.month ? new Date(Date.UTC(year, month + 1, 1)) : new Date(Date.UTC(year + 1, 0, 1));
        where.date = { gte: start, lt: end };
      }
      return db.holiday.findMany({ where, orderBy: { date: 'asc' }, select: { id: true, date: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
    });
    res.json({ data: data.map((h: any) => ({ ...h, date: h.date.toISOString().slice(0,10) })) });
  });
  router.post('/holidays', requirePermission(PERMISSIONS.HOLIDAY_WRITE), validate({ body: createOrgHolidaySchema }), async (req, res) => {
    try {
      const row = await run(ctx(req), async (db: any) => db.holiday.create({ data: { date: new Date(`${req.body.date}T00:00:00.000Z`), name: req.body.name }, select: { id: true, date: true, name: true, isActive: true, createdAt: true, updatedAt: true } }));
      res.status(201).json({ data: { ...row, date: row.date.toISOString().slice(0,10) } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('A holiday already exists for this date');
      throw e;
    }
  });
  router.patch('/holidays/:id', requirePermission(PERMISSIONS.HOLIDAY_WRITE), validate({ params: orgHolidayIdParamSchema, body: updateOrgHolidaySchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    try {
      const row = await run(ctx(req), async (db: any) => {
        const existing = await db.holiday.findFirst({ where: { id } });
        if (!existing) throw new NotFoundError('Holiday not found');
        return db.holiday.update({ where: { id }, data: { date: req.body.date ? new Date(`${req.body.date}T00:00:00.000Z`) : undefined, name: req.body.name, isActive: req.body.isActive }, select: { id: true, date: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
      });
      res.json({ data: { ...row, date: row.date.toISOString().slice(0,10) } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ValidationError('A holiday already exists for this date');
      throw e;
    }
  });
  router.delete('/holidays/:id', requirePermission(PERMISSIONS.HOLIDAY_WRITE), validate({ params: orgHolidayIdParamSchema }), async (req, res) => {
    const { id } = req.params as { id: string };
    await run(ctx(req), async (db: any) => {
      const deleted = await db.holiday.deleteMany({ where: { id } });
      if (deleted.count === 0) throw new NotFoundError('Holiday not found');
    });
    res.status(204).send();
  });

  // Org hierarchy (basic: active employees with manager relations)
  router.get('/hierarchy', canReadOrg, async (req, res) => {
    const rows = await run(ctx(req), async (db: any) => db.employee.findMany({
      where: { status: { not: 'TERMINATED' } },
      select: { id: true, employeeNumber: true, firstName: true, lastName: true, jobTitle: true, managerId: true, department: { select: { id: true, name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    })) as Array<any>;
    const byId = new Map<string, any>();
    for (const r of rows) {
      byId.set(r.id, { id: r.id, employeeNumber: r.employeeNumber, name: `${r.firstName} ${r.lastName}`.trim(), jobTitle: r.jobTitle, department: r.department, managerId: r.managerId, reports: [] as any[] });
    }
    const roots: any[] = [];
    for (const node of byId.values()) {
      if (node.managerId && byId.has(node.managerId)) byId.get(node.managerId).reports.push(node);
      else roots.push(node);
    }
    const strip = (n: any): any => ({ id: n.id, employeeNumber: n.employeeNumber, name: n.name, jobTitle: n.jobTitle, department: n.department, reports: (n.reports as any[]).map(strip) });
    res.json({ data: roots.map(strip) });
  });

  return router;
}
