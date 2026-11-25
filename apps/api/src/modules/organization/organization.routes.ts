/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows (database/tenant/tenant-db.ts) */
import { Router } from 'express';
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
import { ValidationError, NotFoundError } from '../../shared/errors';
import type { PrismaClient } from '../../database/generated/client';
import type { TenantRunner } from '../../database/tenant';
import { recordAudit } from '../audit/audit';

export function createOrganizationRouter(_prisma: PrismaClient, tenantRunner: TenantRunner): Router {
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
      const row = await run(ctx(req), async (db: any) => {
        const created = await db.department.create({ data: { name: req.body.name, description: req.body.description ?? null }, select: { id: true, name: true, description: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'department.created', entity: 'Department', entityId: created.id, newValue: { name: created.name } });
        return created;
      });
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
        // ORG-002: a department that is in use is archived, never deleted. Archiving stops new assignments;
        // current members keep it.
        const updated = await db.department.update({ where: { id }, data: { name: req.body.name, description: req.body.description, isActive: req.body.isActive }, select: { id: true, name: true, description: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'department.updated', entity: 'Department', entityId: id, oldValue: { name: existing.name, description: existing.description, isActive: existing.isActive }, newValue: req.body });
        return updated;
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
      const existing = await db.department.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Department not found');
      await db.department.deleteMany({ where: { id } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'department.deleted', entity: 'Department', entityId: id, oldValue: { name: existing.name } });
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
      const row = await run(ctx(req), async (db: any) => {
        const created = await db.designation.create({ data: { name: req.body.name }, select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'designation.created', entity: 'Designation', entityId: created.id, newValue: { name: created.name } });
        return created;
      });
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
        const updated = await db.designation.update({ where: { id }, data: { name: req.body.name, isActive: req.body.isActive }, select: { id: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'designation.updated', entity: 'Designation', entityId: id, oldValue: { name: existing.name, isActive: existing.isActive }, newValue: req.body });
        return updated;
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
      const existing = await db.designation.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Designation not found');
      await db.designation.deleteMany({ where: { id } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'designation.deleted', entity: 'Designation', entityId: id, oldValue: { name: existing.name } });
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
      const row = await run(ctx(req), async (db: any) => {
        const created = await db.holiday.create({ data: { date: new Date(`${req.body.date}T00:00:00.000Z`), name: req.body.name }, select: { id: true, date: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'CREATED', entity: 'holiday', entityId: created.id, newValue: { date: req.body.date, name: created.name } });
        return created;
      });
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
        const updated = await db.holiday.update({ where: { id }, data: { date: req.body.date ? new Date(`${req.body.date}T00:00:00.000Z`) : undefined, name: req.body.name, isActive: req.body.isActive }, select: { id: true, date: true, name: true, isActive: true, createdAt: true, updatedAt: true } });
        await recordAudit(db, { actorId: req.user!.userId, action: 'UPDATED', entity: 'holiday', entityId: id, oldValue: { date: existing.date, name: existing.name, isActive: existing.isActive }, newValue: req.body });
        return updated;
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
      const existing = await db.holiday.findFirst({ where: { id } });
      if (!existing) throw new NotFoundError('Holiday not found');
      await db.holiday.deleteMany({ where: { id } });
      await recordAudit(db, { actorId: req.user!.userId, action: 'DELETED', entity: 'holiday', entityId: id, oldValue: { date: existing.date, name: existing.name } });
    });
    res.status(204).send();
  });

  // Org hierarchy (basic: active employees with manager relations)
  router.get('/hierarchy', canReadOrg, async (req, res) => {
    const rows = await run(ctx(req), async (db: any) => db.employee.findMany({
      where: { status: { notIn: ['INACTIVE', 'TERMINATED'] } }, // EMP-006
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
