import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../database/generated/client';

/**
 * Minimal in-memory stand-in for the Prisma client, for unit tests ONLY. It lets the real
 * repository and the real tenant layer (`createTenantRunner`) run without a database.
 * It emulates just what the employee module uses: where (AND/OR/NOT, equality, in, contains, gt),
 * orderBy, take, select with to-one relations, create/update, unique indexes and composite FKs.
 * It never connects to anything.
 */

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

export interface RecordedCall {
  model: string;
  operation: string;
  args: Obj;
}

function prismaError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function matches(row: Row, where: unknown): boolean {
  if (!isObj(where)) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(row, w))) return false;
    } else if (key === 'OR') {
      if (!(cond as unknown[]).some((w) => matches(row, w))) return false;
    } else if (key === 'NOT') {
      if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(row, w))) return false;
    } else if (isObj(cond)) {
      const v = row[key];
      if ('in' in cond && !(cond.in as unknown[]).includes(v)) return false;
      if ('contains' in cond) {
        if (typeof v !== 'string') return false;
        if (!v.toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
      }
      if ('gt' in cond && !((v as string) > (cond.gt as string))) return false;
      if ('equals' in cond && v !== cond.equals) return false;
    } else if (row[key] !== cond) {
      return false;
    }
  }
  return true;
}

export interface FakeDb {
  prisma: PrismaClient;
  tables: {
    employee: Row[]; department: Row[]; employeeAuditLog: Row[]; auditLog: Row[]; designation: Row[];
    company: Row[]; companyMembership: Row[]; userSession: Row[]; invitationToken: Row[]; notification: Row[];
    leaveRequest: Row[]; leaveBalance: Row[]; attendanceCorrection: Row[]; onboardingTemplateTask: Row[]; onboardingTask: Row[];
  };
  calls: RecordedCall[];
}

export function createFakePrisma(): FakeDb {
  const tables = {
    employee: [] as Row[],
    department: [] as Row[],
    employeeAuditLog: [] as Row[],
    auditLog: [] as Row[],
    designation: [] as Row[],
    company: [] as Row[],
    companyMembership: [] as Row[],
    userSession: [] as Row[],
    invitationToken: [] as Row[],
    notification: [] as Row[],
    leaveRequest: [] as Row[],
    leaveBalance: [] as Row[],
    attendanceCorrection: [] as Row[],
    onboardingTemplateTask: [] as Row[],
    onboardingTask: [] as Row[],
  };
  const calls: RecordedCall[] = [];

  function project(model: keyof typeof tables, row: Row, select: unknown): Row {
    if (!isObj(select)) return { ...row };
    const out: Row = {};
    for (const [key, want] of Object.entries(select)) {
      if (!want) continue;
      if (model === 'employee' && key === 'department') {
        const d = tables.department.find((x) => x.companyId === row.companyId && x.id === row.departmentId);
        out[key] = d ? project('department', d, (want as Obj).select) : null;
      } else if (model === 'employee' && key === 'designation') {
        const d = tables.designation.find((x) => x.companyId === row.companyId && x.id === row.designationId);
        out[key] = d ? { id: d.id, name: d.name } : null;
      } else if (model === 'employee' && key === 'manager') {
        const m = tables.employee.find((x) => x.companyId === row.companyId && x.id === row.managerId);
        out[key] = m ? project('employee', m, (want as Obj).select) : null;
      } else {
        out[key] = row[key] instanceof Date ? new Date(row[key] as Date) : row[key];
      }
    }
    return out;
  }

  function sorted(rows: Row[], orderBy: unknown): Row[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Obj[];
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const [field, dir] = Object.entries(k)[0] as [string, string];
        const av = a[field] as string;
        const bv = b[field] as string;
        if (av === bv) continue;
        return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }

  function checkEmployee(row: Row, selfId?: string) {
    for (const other of tables.employee) {
      if (other.id === selfId || other.companyId !== row.companyId) continue;
      if (other.employeeNumber === row.employeeNumber) throw prismaError('P2002', 'employeeNumber unique');
      if (row.workEmail != null && other.workEmail === row.workEmail) throw prismaError('P2002', 'workEmail unique');
    }
    // Composite FKs (companyId, departmentId) / (companyId, managerId): same-company only.
    if (row.departmentId != null && !tables.department.some((d) => d.companyId === row.companyId && d.id === row.departmentId)) {
      throw prismaError('P2003', 'department FK');
    }
    if (row.managerId != null && !tables.employee.some((e) => e.companyId === row.companyId && e.id === row.managerId)) {
      throw prismaError('P2003', 'manager FK');
    }
  }

  function delegate(model: keyof typeof tables, name: string) {
    const rec = (operation: string, args: unknown) => calls.push({ model: name, operation, args: (args ?? {}) as Obj });
    const table = tables[model];
    const find = (args: Obj) => {
      const rows = sorted(table.filter((r) => matches(r, args.where)), args.orderBy);
      return typeof args.take === 'number' ? rows.slice(0, args.take) : rows;
    };
    return {
      findMany: async (args: Obj = {}) => {
        rec('findMany', args);
        return find(args).map((r) => project(model, r, args.select));
      },
      findFirst: async (args: Obj = {}) => {
        rec('findFirst', args);
        const r = find(args)[0];
        return r ? project(model, r, args.select) : null;
      },
      findUnique: async (args: Obj = {}) => {
        rec('findUnique', args);
        const r = table.find((x) => matches(x, args.where));
        return r ? project(model, r, args.select) : null;
      },
      create: async (args: Obj) => {
        rec('create', args);
        const now = new Date();
        const data = args.data as Row;
        const base: Row =
          model === 'employee'
            ? { workEmail: null, jobTitle: null, employmentType: 'FULL_TIME', status: 'ONBOARDING', hireDate: null, terminationDate: null, departmentId: null, managerId: null }
            : {};
        const row: Row = { ...base, ...data, id: randomUUID(), createdAt: now, updatedAt: now };
        if (model === 'employee') checkEmployee(row);
        table.push(row);
        return project(model, row, args.select);
      },
      count: async (args: Obj = {}) => {
        rec('count', args);
        return table.filter((r) => matches(r, args.where)).length;
      },
      createMany: async (args: Obj) => {
        rec('createMany', args);
        const rows = ([] as Row[]).concat(args.data as Row[]);
        for (const r of rows) table.push({ ...r, id: randomUUID(), createdAt: new Date() });
        return { count: rows.length };
      },
      updateMany: async (args: Obj) => {
        rec('updateMany', args);
        const found = table.filter((r) => matches(r, args.where));
        for (const r of found) Object.assign(r, args.data as Row);
        return { count: found.length };
      },
      update: async (args: Obj) => {
        rec('update', args);
        const r = table.find((x) => matches(x, args.where));
        if (!r) throw prismaError('P2025', 'not found');
        const next = { ...r, ...(args.data as Row), updatedAt: new Date() };
        if (model === 'employee') checkEmployee(next, r.id as string);
        Object.assign(r, next);
        return project(model, r, args.select);
      },
    };
  }

  const modelName = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
  const db = Object.fromEntries(
    (Object.keys(tables) as (keyof typeof tables)[]).map((key) => [key, delegate(key, modelName(key))]),
  );

  const prisma = {
    ...db,
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    // The real runner opens an interactive transaction; here every unit of work runs directly.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  } as unknown as PrismaClient;

  return { prisma, tables, calls };
}
