import crypto from 'node:crypto';
import type {
  ChangeEmployeeStatus,
  CreateEmployee,
  EmployeeListQuery,
  EmployeeSelfUpdate,
  UpdateEmployee,
} from '@gsc/contracts';
import type { Prisma } from '../../database/generated/client';
import type { TenantDb } from '../../database/tenant';
import type { TenantContext } from '../../database/tenant/types';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { secureToken, tokenHash } from '../auth/password';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';
import type {
  Actor,
  EmployeePage,
  EmployeeRepository,
  EmployeeRow,
  ReadScope,
  TimelineEntry,
} from './employees.types';

/** Runs a unit of work in a tenant-bound transaction. Production: `withTenant`. */
export type TenantRunner = <T>(ctx: TenantContext, fn: (db: TenantDb, tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

type Obj = Record<string, unknown>;

const SELECT = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  workEmail: true,
  phone: true,
  address: true,
  emergencyContact: true,
  jobTitle: true,
  employmentType: true,
  status: true,
  hireDate: true,
  joiningDate: true,
  terminationDate: true,
  exitDate: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  manager: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  membership: { select: { status: true, userId: true } },
} as const;

const ORDER = [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }] as const;
const MAX_CHAIN = 1000;

// ---------- cursor (opaque keyset position: lastName, firstName, id) ----------

export function encodeCursor(row: Pick<EmployeeRow, 'lastName' | 'firstName' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.lastName, row.firstName, row.id])).toString('base64url');
}

export function decodeCursor(cursor: string): { lastName: string; firstName: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((p) => typeof p === 'string')) {
      return { lastName: parsed[0] as string, firstName: parsed[1] as string, id: parsed[2] as string };
    }
  } catch {
    /* fall through */
  }
  throw new ValidationError('Invalid cursor');
}

// ---------- helpers ----------

/**
 * Prisma's `contains` does not escape LIKE wildcards, so a literal "%" or "_" typed into the search
 * box would match everything. PostgreSQL's default LIKE escape character is the backslash.
 */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00.000Z`);
const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Row filter for the caller's read scope. `team` is direct AND indirect reports (PRD section 5),
 * resolved from the reporting line inside the caller's company on the same transaction.
 */
async function scopeWhere(db: TenantDb, scope: ReadScope): Promise<Obj[] | 'none'> {
  if (scope.kind === 'all') return [];
  if (!scope.employeeId) return 'none'; // no linked employee profile: nothing is in team/self scope
  const any: Obj[] = [];
  if (scope.team) {
    const teamIds = await resolveTeamEmployeeIds(db, scope.employeeId);
    if (teamIds.length > 0) any.push({ id: { in: teamIds } });
  }
  if (scope.self) any.push({ id: scope.employeeId });
  return any.length > 0 ? [{ OR: any }] : 'none';
}

function isPrismaCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

function rethrow(err: unknown): never {
  if (isPrismaCode(err, 'P2002')) {
    throw new ConflictError('A record with the same unique value already exists');
  }
  if (isPrismaCode(err, 'P2025')) throw new NotFoundError('Employee not found');
  // The database trigger is the concurrency-safe backstop for reporting cycles (two requests that both passed the
  // API check): surface it as the same 400 the API check gives, never a 500.
  const text = `${(err as { message?: unknown })?.message ?? ''} ${JSON.stringify((err as { meta?: unknown })?.meta ?? {})}`;
  if (/employees_no_manager_cycle|Reporting cycle/.test(text)) {
    throw new ValidationError('An employee cannot report, directly or indirectly, to themselves');
  }
  if (isPrismaCode(err, 'P2003')) throw new NotFoundError('Referenced record not found');
  throw err;
}

type Change = { from: unknown; to: unknown };

async function writeAudit(
  db: TenantDb,
  actor: Actor,
  employeeId: string,
  action: string,
  changes: Record<string, Change>,
): Promise<void> {
  const data = {
    employeeId,
    actorUserId: actor.userId,
    action,
    changes: changes as Prisma.InputJsonObject,
  } as any;
  await (db as any).employeeAuditLog.create({ data });
}

async function requireDepartment(db: TenantDb, id: string): Promise<void> {
  const found = await (db as any).department.findFirst({ where: { id, isActive: true }, select: { id: true } });
  if (!found) throw new NotFoundError('Department not found or inactive');
}

async function requireDesignation(db: TenantDb, id: string): Promise<void> {
  const found = await (db as any).designation.findFirst({ where: { id, isActive: true }, select: { id: true } });
  if (!found) throw new NotFoundError('Designation not found or inactive');
}

async function requireManager(db: TenantDb, id: string): Promise<void> {
  const found = await (db as any).employee.findFirst({ where: { id }, select: { id: true, status: true } });
  if (!found) throw new NotFoundError('Manager not found');
  if (found.status === 'TERMINATED' || found.status === 'INACTIVE') {
    throw new ValidationError('An inactive employee cannot be assigned as a manager', [
      { path: ['managerId'], message: 'Choose an active employee' },
    ]);
  }
}

async function assertNoCycle(db: TenantDb, employeeId: string, managerId: string): Promise<void> {
  let current: string | null = managerId;
  for (let i = 0; current && i < MAX_CHAIN; i++) {
    if (current === employeeId) {
      throw new ValidationError('An employee cannot report, directly or indirectly, to themselves');
    }
    const next: { managerId: string | null } | null = await (db as any).employee.findFirst({
      where: { id: current },
      select: { managerId: true },
    });
    current = next?.managerId ?? null;
  }
}

async function assertUnique(db: TenantDb, field: 'employeeNumber' | 'workEmail', value: string, exceptId?: string): Promise<void> {
  const where: any = { ...(exceptId ? { NOT: { id: exceptId } } : {}) };
  if (field === 'workEmail') where.workEmail = { equals: value, mode: 'insensitive' };
  else where.employeeNumber = value;
  const clash = await (db as any).employee.findFirst({ where, select: { id: true } });
  if (clash) {
    throw new ConflictError(
      field === 'employeeNumber' ? 'Employee number already exists' : 'Work email already exists in this company',
      { field },
    );
  }
}

function assertDateOrder(joiningOrHire: Date | null, exitOrTermination: Date | null, field = 'exitDate'): void {
  if (joiningOrHire && exitOrTermination && exitOrTermination < joiningOrHire) {
    throw new ValidationError(`${field} cannot be before joining date`);
  }
}

async function nextEmployeeNumber(ctx: TenantContext, tx: Prisma.TransactionClient): Promise<string> {
  // Atomic per-company sequence using raw SQL in same tenant-scoped transaction.
  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    INSERT INTO "employee_number_sequences" ("id", "companyId", "nextValue", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${ctx.companyId}, 2, NOW())
    ON CONFLICT ("companyId")
    DO UPDATE SET "nextValue" = "employee_number_sequences"."nextValue" + 1, "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS "nextValue"
  `;
  const n = rows[0]?.nextValue ?? 1;
  return `EMP-${String(n).padStart(4, '0')}`;
}

async function ensureNoPendingAttendanceCorrection(db: TenantDb, employeeId: string): Promise<void> {
  const pending = (await (db as any).attendanceCorrection?.findFirst?.({ where: { employeeId, status: 'PENDING' }, select: { id: true } })) ?? null;
  if (pending) {
    throw new ValidationError('Pending attendance correction requests must be resolved before deactivation');
  }
}

// ---------- repository ----------

export function createEmployeeRepository(run: TenantRunner): EmployeeRepository {
  return {
    async list(ctx, scope, query: EmployeeListQuery): Promise<EmployeePage> {
      const and: Obj[] = [];

      for (const token of (query.q ?? '').split(/\s+/).filter(Boolean)) {
        const c = { contains: escapeLike(token), mode: 'insensitive' } as const;
        and.push({ OR: [{ firstName: c }, { lastName: c }, { employeeNumber: c }, { workEmail: c }] });
      }
      if (query.status?.length) and.push({ status: { in: query.status } });
      if (query.employmentType?.length) and.push({ employmentType: { in: query.employmentType } });
      if (query.departmentId) and.push({ departmentId: query.departmentId });
      if ((query as any).designationId) and.push({ designationId: (query as any).designationId });
      if (query.managerId) and.push({ managerId: query.managerId });
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        and.push({
          OR: [
            { lastName: { gt: c.lastName } },
            { lastName: c.lastName, firstName: { gt: c.firstName } },
            { lastName: c.lastName, firstName: c.firstName, id: { gt: c.id } },
          ],
        });
      }

      return run(ctx, async (db) => {
        const scoped = await scopeWhere(db, scope);
        if (scoped === 'none') return { rows: [], nextCursor: null };
        const found = (await db.employee.findMany({
          where: { AND: [...scoped, ...and] },
          orderBy: [...ORDER],
          take: query.limit + 1,
          select: SELECT,
        })) as EmployeeRow[];
        const rows = found.slice(0, query.limit);
        const last = rows[rows.length - 1];
        return { rows, nextCursor: found.length > query.limit && last ? encodeCursor(last) : null };
      });
    },

    async get(ctx, scope, id) {
      return run(ctx, async (db) => {
        const scoped = await scopeWhere(db, scope);
        if (scoped === 'none') return null;
        const row = await db.employee.findFirst({
          where: { AND: [{ id }, ...scoped] },
          select: SELECT,
        });
        return (row as EmployeeRow | null) ?? null;
      });
    },

    async create(ctx, actor, input: CreateEmployee) {
      try {
        return await run(ctx, async (db, tx) => {
          const employeeNumber = input.employeeNumber ?? (await nextEmployeeNumber(ctx, tx));
          const workEmail = input.workEmail.toLowerCase();
          await assertUnique(db, 'employeeNumber', employeeNumber);
          await assertUnique(db, 'workEmail', workEmail);
          await requireDepartment(db, input.departmentId);
          if (input.designationId) await requireDesignation(db, input.designationId);
          if (input.managerId) await requireManager(db, input.managerId);

          const hireDate = toDate(input.hireDate ?? input.joiningDate ?? undefined) ?? null;
          const joiningDate = toDate(input.joiningDate ?? input.hireDate ?? undefined) ?? null;
          const data = {
            employeeNumber,
            firstName: input.firstName,
            lastName: input.lastName,
            workEmail,
            phone: input.phone ?? null,
            address: input.address ?? null,
            emergencyContact: input.emergencyContact ?? null,
            jobTitle: input.jobTitle ?? null,
            designationId: input.designationId ?? null,
            employmentType: input.employmentType ?? 'FULL_TIME',
            status: 'ONBOARDING',
            hireDate,
            joiningDate,
            departmentId: input.departmentId,
            managerId: input.managerId ?? null,
          } as any;
          const row = (await (db as any).employee.create({ data, select: SELECT })) as EmployeeRow;
          await writeAudit(db, actor, row.id, 'CREATED', {
            employeeNumber: { from: null, to: row.employeeNumber },
            firstName: { from: null, to: row.firstName },
            lastName: { from: null, to: row.lastName },
            workEmail: { from: null, to: row.workEmail },
            status: { from: null, to: row.status },
          });
          // Auto-create onboarding tasks from active templates (best effort, same tx)
          const templates = (await (db as any).onboardingTemplateTask?.findMany?.({ where: { isActive: true }, select: { title: true, dueOffsetDays: true, assigneeType: true } })) ?? [];
          if (templates?.length) {
            for (const t of templates) {
              const dueDate = t.dueOffsetDays != null && joiningDate ? new Date(joiningDate.getTime() + t.dueOffsetDays * 86400000) : null;
              await (db as any).onboardingTask.create({ data: { employeeId: row.id, title: t.title, dueDate, assigneeType: t.assigneeType } });
            }
          }
          return row;
        });
      } catch (e) { rethrow(e); }
    },

    async update(ctx, actor, id, patch: UpdateEmployee) {
      try {
        return await run(ctx, async (db) => {
          const current = (await (db as any).employee.findFirst({ where: { id }, select: SELECT })) as EmployeeRow | null;
          if (!current) throw new NotFoundError('Employee not found');

          if (patch.employeeNumber && patch.employeeNumber !== current.employeeNumber) await assertUnique(db, 'employeeNumber', patch.employeeNumber, id);
          if (patch.workEmail !== undefined) {
            const email = patch.workEmail.toLowerCase();
            if (email !== (current.workEmail ?? '').toLowerCase()) await assertUnique(db, 'workEmail', email, id);
          }
          if (patch.departmentId !== undefined) {
            if (patch.departmentId) await requireDepartment(db, patch.departmentId);
          }
          if (patch.designationId !== undefined && patch.designationId) await requireDesignation(db, patch.designationId);
          if (patch.managerId !== undefined) {
            if (patch.managerId === id) throw new ValidationError('An employee cannot be their own manager');
            if (patch.managerId) { await requireManager(db, patch.managerId); await assertNoCycle(db, id, patch.managerId); }
          }

          // Joining date is canonical (PRD EMP-001); hireDate is its legacy mirror and always changes with it.
          const joiningPatched = patch.joiningDate !== undefined || patch.hireDate !== undefined;
          const newJoining = joiningPatched ? toDate(patch.joiningDate !== undefined ? patch.joiningDate : patch.hireDate) ?? null : undefined;
          const effectiveJoining = joiningPatched ? newJoining ?? null : current.joiningDate ?? current.hireDate;
          assertDateOrder(effectiveJoining ?? null, current.exitDate ?? current.terminationDate ?? null);

          // Minimal change set: only fields that actually differ are written and audited.
          const data: any = {};
          const diff: Record<string, Change> = {};
          const set = (field: string, from: unknown, to: unknown, dbValue: unknown = to) => {
            if ((from ?? null) === (to ?? null)) return;
            data[field] = dbValue;
            diff[field] = { from: from ?? null, to: to ?? null };
          };
          if (patch.employeeNumber !== undefined) set('employeeNumber', current.employeeNumber, patch.employeeNumber);
          if (patch.firstName !== undefined) set('firstName', current.firstName, patch.firstName);
          if (patch.lastName !== undefined) set('lastName', current.lastName, patch.lastName);
          if (patch.workEmail !== undefined) set('workEmail', current.workEmail, patch.workEmail.toLowerCase());
          if (patch.phone !== undefined) set('phone', (current as any).phone, patch.phone ?? null);
          if (patch.address !== undefined) set('address', (current as any).address, patch.address ?? null);
          if (patch.emergencyContact !== undefined) set('emergencyContact', (current as any).emergencyContact, patch.emergencyContact ?? null);
          if (patch.jobTitle !== undefined) set('jobTitle', current.jobTitle, patch.jobTitle ?? null);
          if (patch.designationId !== undefined) set('designationId', current.designation?.id ?? null, patch.designationId ?? null);
          if (patch.employmentType !== undefined) set('employmentType', current.employmentType, patch.employmentType);
          if (joiningPatched) {
            const from = isoDay(current.joiningDate ?? current.hireDate);
            const to = isoDay(newJoining ?? null);
            if (from !== to) {
              data.joiningDate = newJoining ?? null;
              data.hireDate = newJoining ?? null;
              diff.joiningDate = { from, to };
            }
          }
          if (patch.departmentId !== undefined) set('departmentId', current.department?.id ?? null, patch.departmentId ?? null);
          if (patch.managerId !== undefined) set('managerId', current.manager?.id ?? null, patch.managerId ?? null);

          if (Object.keys(diff).length === 0) return current; // nothing changed: no write, no audit

          const row = (await (db as any).employee.update({ where: { id }, data, select: SELECT })) as EmployeeRow;

          // One timeline entry per kind of change, each with old and new values (PRD EMP-005, EMP-008).
          const { departmentId, managerId, ...rest } = diff;
          if (departmentId) await writeAudit(db, actor, id, 'DEPARTMENT_CHANGED', { departmentId });
          if (managerId) await writeAudit(db, actor, id, 'MANAGER_CHANGED', { managerId });
          if (Object.keys(rest).length > 0) await writeAudit(db, actor, id, 'UPDATED', rest);
          return row;
        });
      } catch (e) { rethrow(e); }
    },

    async selfUpdate(ctx, actor, id, patch: EmployeeSelfUpdate) {
      try {
        return await run(ctx, async (db) => {
          const current = await (db as any).employee.findFirst({ where: { id }, select: SELECT });
          if (!current) throw new NotFoundError('Employee not found');
          const row = await (db as any).employee.update({ where: { id }, data: { phone: patch.phone ?? null, address: patch.address ?? null, emergencyContact: patch.emergencyContact ?? null }, select: SELECT });
          await writeAudit(db, actor, id, 'UPDATED', { selfProfile: { from: null, to: 'updated' } });
          return row as EmployeeRow;
        });
      } catch (e) { rethrow(e); }
    },

    async changeStatus(ctx, actor, id, change: ChangeEmployeeStatus) {
      try {
        return await run(ctx, async (db) => {
          const current = await (db as any).employee.findFirst({ where: { id }, select: SELECT });
          if (!current) throw new NotFoundError('Employee not found');
          if (change.status === 'TERMINATED' || change.status === 'INACTIVE') {
            await ensureNoPendingAttendanceCorrection(db, id);
            // Block deactivation of linked Super Admin's own account context? best-effort: membership role check
            const membership = (await (db as any).companyMembership?.findFirst?.({ where: { employeeId: id }, select: { role: { select: { key: true } }, userId: true, id: true } })) ?? null;
            if (membership?.role?.key === 'SUPER_ADMIN') {
              const count = (await (db as any).companyMembership?.count?.({ where: { role: { is: { key: 'SUPER_ADMIN' } }, status: 'ACTIVE' } })) ?? 2;
              if ((count ?? 0) <= 1) throw new ValidationError('Cannot deactivate the last Super Admin');
            }
            // disable linked login
            if (membership?.userId) {
              await (db as any).userSession?.updateMany?.({ where: { userId: membership.userId, revokedAt: null }, data: { revokedAt: new Date() } });
              // also revoke memberships for this employee's user? keep membership but sessions revoked; app rejects disabled users.
            }
          }
          const exitDate = (change as any).exitDate ?? (change as any).terminationDate;
          if (exitDate) assertDateOrder(current.joiningDate ?? current.hireDate ?? null, toDate(exitDate) ?? null);
          const terminal = change.status === 'TERMINATED' || change.status === 'INACTIVE';
          const currentExit = isoDay(current.exitDate ?? current.terminationDate ?? null);
          const newExit = terminal ? isoDay(toDate(exitDate) ?? null) : null; // reactivation clears the exit date
          if (change.status === current.status && newExit === currentExit) return current as EmployeeRow; // no-op: no write, no audit

          const data: any = { status: change.status, exitDate: toDate(newExit) ?? null, terminationDate: toDate(newExit) ?? null };
          const row = await (db as any).employee.update({ where: { id }, data, select: SELECT });
          const changes: Record<string, Change> = { status: { from: current.status, to: row.status } };
          if (newExit !== currentExit) {
            changes[change.status === 'INACTIVE' ? 'exitDate' : 'terminationDate'] = { from: currentExit, to: newExit };
          }
          await writeAudit(db, actor, id, 'STATUS_CHANGED', changes);
          // TODO: notify direct reports' managers/HR for reassignment when deactivated (handled in higher layer)
          return row as EmployeeRow;
        });
      } catch (e) { rethrow(e); }
    },

    async timeline(ctx, scope, id) {
      return run(ctx, async (db) => {
        const scoped = await scopeWhere(db, scope);
        if (scoped === 'none') throw new NotFoundError('Employee not found');
        const exists = await (db as any).employee.findFirst({ where: { AND: [{ id }, ...scoped] }, select: { id: true } });
        if (!exists) throw new NotFoundError('Employee not found');
        const logs = await (db as any).employeeAuditLog.findMany({
          where: { employeeId: id },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, action: true, changes: true, createdAt: true, actorUserId: true, actor: { select: { id: true, name: true } } },
        }).catch(async () => {
          const basic = await (db as any).employeeAuditLog.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
          return basic.map((l: any) => ({ ...l, actor: null }));
        });
        return logs.map((l: any): TimelineEntry => ({
          id: l.id,
          action: l.action,
          changes: l.changes ?? {},
          actor: l.actor ? { id: l.actor.id, name: l.actor.name } : { id: l.actorUserId ?? null },
          timestamp: new Date(l.createdAt).toISOString(),
        }));
      });
    },

    async sendInvitation(ctx, actor, id) {
      // Minimal implementation: requires employee with work email and no existing active membership.
      try {
        return await run(ctx, async (db) => {
          const emp = await (db as any).employee.findFirst({ where: { id }, select: { id: true, workEmail: true, firstName: true, lastName: true, membership: { select: { id: true, status: true } } } });
          if (!emp) throw new NotFoundError('Employee not found');
          if (!emp.workEmail) throw new ValidationError('Employee must have a work email before inviting');
          if (emp.membership?.status === 'ACTIVE') throw new ValidationError('Employee already has an active login account');
          // Ensure/find user and membership in INVITED state with EMPLOYEE role by default.
          const email = emp.workEmail.toLowerCase();
          const employeeRole = await (db as any).role.findFirst({ where: { key: 'EMPLOYEE' }, select: { id: true } });
          if (!employeeRole) throw new ValidationError('Employee role not configured');
          let user = await (db as any).user.findFirst({ where: { email }, select: { id: true, email: true } });
          if (!user) {
            // global user uniqueness by email exists in schema; create minimal identity
            user = await (db as any).user.create({ data: { externalId: `local:${crypto.randomUUID()}`, email, name: `${emp.firstName} ${emp.lastName}`.trim() }, select: { id: true, email: true } }).catch(async () => (db as any).user.findFirst({ where: { email }, select: { id: true, email: true } }));
          }
          let membership = await (db as any).companyMembership.findFirst({ where: { userId: user.id }, select: { id: true, status: true, employeeId: true } });
          if (!membership) {
            membership = await (db as any).companyMembership.create({ data: { userId: user.id, roleId: employeeRole.id, employeeId: emp.id, status: 'INVITED' }, select: { id: true, status: true, employeeId: true } });
          } else {
            if (membership.status === 'ACTIVE') throw new ValidationError('User already has an active account in this company');
            await (db as any).companyMembership.update({ where: { id: membership.id }, data: { employeeId: emp.id, status: 'INVITED' } });
          }
          // revoke old tokens and issue new invitation token
          await (db as any).invitationToken?.updateMany?.({ where: { membershipId: membership.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
          const token = secureToken(32);
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // PRD AUTH-004: link valid 7 days
          await (db as any).invitationToken?.create?.({ data: { companyId: ctx.companyId, userId: user.id, membershipId: membership.id, tokenHash: tokenHash(token), expiresAt } });
          await writeAudit(db, actor, id, emp.membership ? 'INVITATION_RESENT' : 'INVITATION_SENT', { workEmail: { from: null, to: email } });
          // TODO: send invitation email via configured provider; token must not be exposed except delivery channel/logs in dev
          return { status: emp.membership ? 'RESENT' : 'INVITED', expiresAt: expiresAt.toISOString() };
        });
      } catch (e) { rethrow(e); }
    },
  };
}
