/**
 * DEMO ADAPTER. In-memory stand-in for the Employees API so the UI can be built and tested without a
 * backend, database or authentication. It re-implements the API's documented rules (read scope,
 * permissions, uniqueness, cycle and date checks, cursor paging) using the SAME contract schemas as
 * the real API. Nothing here is persisted: a page reload resets the data.
 */
import {
  changeEmployeeStatusSchema,
  createEmployeeSchema,
  employeeListQuerySchema,
  updateEmployeeSchema,
  type Employee,
  type EmployeeListQueryInput,
} from '@gsc/contracts';
import { ApiError } from '../../errors';
import { capabilities, type Session } from '../../permissions';
import type { DepartmentOption, EmployeesService } from '../../service';
import { buildDemoRows, DEMO_DEPARTMENTS, demoUuid, type DemoRow } from './demo-data';

export interface DemoStore {
  departments: DepartmentOption[];
  rows: DemoRow[];
  nextNumber: number;
}

export function createDemoStore(): DemoStore {
  return { departments: structuredClone(DEMO_DEPARTMENTS), rows: buildDemoRows(), nextNumber: 100 };
}

export interface DemoOptions {
  /** Simulated network delay. Tests pass 0. */
  latencyMs?: number;
  now?: () => Date;
}

type Key = Pick<DemoRow, 'lastName' | 'firstName' | 'id'>;

/** Total order: lastName, firstName, id. Same comparator for sorting and for the cursor. */
const compare = (a: Key, b: Key) =>
  a.lastName < b.lastName
    ? -1
    : a.lastName > b.lastName
      ? 1
      : a.firstName < b.firstName
        ? -1
        : a.firstName > b.firstName
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;

const encode = (r: Key) =>
  btoa(JSON.stringify([r.lastName, r.firstName, r.id]))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

function decode(cursor: string): Key {
  try {
    const parsed: unknown = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((p) => typeof p === 'string')
    ) {
      return {
        lastName: parsed[0] as string,
        firstName: parsed[1] as string,
        id: parsed[2] as string,
      };
    }
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor');
}

const validation = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);
const forbidden = () =>
  new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
const notFound = (what = 'Employee') => new ApiError(404, 'NOT_FOUND', `${what} not found`);

interface Parsable<T> {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: unknown[] } };
}

export function createDemoEmployeesService(
  store: DemoStore,
  getSession: () => Session,
  { latencyMs = 150, now = () => new Date() }: DemoOptions = {},
): EmployeesService {
  const wait = () =>
    latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve();

  const toDto = (r: DemoRow): Employee => {
    const m = r.managerId ? store.rows.find((x) => x.id === r.managerId) : undefined;
    const d = r.departmentId ? store.departments.find((x) => x.id === r.departmentId) : undefined;
    return {
      id: r.id,
      employeeNumber: r.employeeNumber,
      firstName: r.firstName,
      lastName: r.lastName,
      workEmail: r.workEmail,
      jobTitle: r.jobTitle,
      employmentType: r.employmentType,
      status: r.status,
      hireDate: r.hireDate,
      terminationDate: r.terminationDate,
      department: d ? { id: d.id, name: d.name } : null,
      manager: m
        ? {
            id: m.id,
            employeeNumber: m.employeeNumber,
            firstName: m.firstName,
            lastName: m.lastName,
          }
        : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  };

  /** Rows the caller may read: all / direct reports + self / self. 403 when no read permission. */
  const visible = (s: Session): DemoRow[] => {
    const c = capabilities(s);
    if (c.readAll) return store.rows;
    if (!c.readTeam && !c.readSelf) throw forbidden();
    if (!s.employeeId) return [];
    return store.rows.filter(
      (r) => (c.readTeam && r.managerId === s.employeeId) || (c.readSelf && r.id === s.employeeId),
    );
  };

  const mustFind = (s: Session, id: string): DemoRow => {
    const row = visible(s).find((r) => r.id === id);
    if (!row) throw notFound(); // out of scope is reported as 404, never 403
    return row;
  };

  const need = (allowed: boolean) => {
    if (!allowed) throw forbidden();
  };

  const parse = <T>(schema: Parsable<T>, input: unknown): T => {
    const r = schema.safeParse(input);
    if (!r.success) throw validation('Request validation failed', r.error.issues);
    return r.data;
  };

  const assertUnique = (
    field: 'employeeNumber' | 'workEmail',
    value: string,
    exceptId?: string,
  ) => {
    const clash = store.rows.find(
      (r) => r.id !== exceptId && r[field]?.toLowerCase() === value.toLowerCase(),
    );
    if (clash) {
      throw new ApiError(
        409,
        'CONFLICT',
        field === 'employeeNumber'
          ? 'An employee with this employee number already exists'
          : 'An employee with this work email already exists',
        { field },
      );
    }
  };

  const assertRefs = (departmentId?: string | null, managerId?: string | null) => {
    if (departmentId && !store.departments.some((d) => d.id === departmentId))
      throw notFound('Department');
    if (managerId) {
      const manager = store.rows.find((r) => r.id === managerId);
      if (!manager) throw notFound('Manager');
      // same rule as the API: someone who has left cannot be given reports
      if (manager.status === 'TERMINATED') {
        throw validation('A terminated employee cannot be assigned as a manager', [
          { path: ['managerId'], message: 'Choose an employee who is still employed' },
        ]);
      }
    }
  };

  const assertNoCycle = (employeeId: string, managerId: string) => {
    let current: string | null = managerId;
    for (let i = 0; current && i < 1000; i++) {
      if (current === employeeId)
        throw validation('An employee cannot report, directly or indirectly, to themselves');
      const id: string = current;
      current = store.rows.find((r) => r.id === id)?.managerId ?? null;
    }
  };

  const assertDates = (hire: string | null, term: string | null) => {
    if (hire && term && term < hire)
      throw validation('Termination date cannot be before the hire date');
  };

  const stamp = () => now().toISOString();

  return {
    kind: 'demo',

    async list(query: EmployeeListQueryInput) {
      await wait();
      const q = parse(employeeListQuerySchema, query);
      let rows = visible(getSession());
      if (q.status?.length) rows = rows.filter((r) => q.status!.includes(r.status));
      if (q.employmentType?.length)
        rows = rows.filter((r) => q.employmentType!.includes(r.employmentType));
      if (q.departmentId) rows = rows.filter((r) => r.departmentId === q.departmentId);
      if (q.managerId) rows = rows.filter((r) => r.managerId === q.managerId);
      const words = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length) {
        rows = rows.filter((r) => {
          const hay = [r.firstName, r.lastName, r.employeeNumber, r.workEmail ?? ''].map((v) =>
            v.toLowerCase(),
          );
          return words.every((w) => hay.some((h) => h.includes(w)));
        });
      }
      rows = [...rows].sort(compare);
      if (q.cursor) {
        const marker = decode(q.cursor);
        rows = rows.filter((r) => compare(r, marker) > 0);
      }
      const page = rows.slice(0, q.limit);
      const next = rows.length > q.limit ? encode(page[page.length - 1]!) : null;
      return { data: page.map(toDto), page: { limit: q.limit, nextCursor: next } };
    },

    async get(id) {
      await wait();
      return toDto(mustFind(getSession(), id));
    },

    async create(input) {
      await wait();
      need(capabilities(getSession()).canCreate);
      const v = parse(createEmployeeSchema, input);
      // The API numbers new employees itself when none is given (PRD EMP-002: EMP-0001, four digits).
      const employeeNumber = v.employeeNumber ?? `EMP-${String(store.nextNumber).padStart(4, '0')}`;
      assertUnique('employeeNumber', employeeNumber);
      if (v.workEmail) assertUnique('workEmail', v.workEmail);
      assertRefs(v.departmentId, v.managerId);
      const ts = stamp();
      const row: DemoRow = {
        id: demoUuid(store.nextNumber++),
        employeeNumber,
        firstName: v.firstName,
        lastName: v.lastName,
        workEmail: v.workEmail ?? null,
        jobTitle: v.jobTitle ?? null,
        employmentType: v.employmentType,
        status: 'ONBOARDING',
        hireDate: v.joiningDate ?? v.hireDate ?? null,
        terminationDate: null,
        departmentId: v.departmentId,
        managerId: v.managerId ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      store.rows.push(row);
      return toDto(row);
    },

    async update(id, input) {
      await wait();
      const s = getSession();
      need(capabilities(s).canEdit);
      const v = parse(updateEmployeeSchema, input);
      const row = mustFind(s, id);
      if (v.employeeNumber !== undefined) assertUnique('employeeNumber', v.employeeNumber, id);
      if (v.workEmail) assertUnique('workEmail', v.workEmail, id);
      assertRefs(v.departmentId, v.managerId);
      if (v.managerId) assertNoCycle(id, v.managerId);
      assertDates(v.hireDate === undefined ? row.hireDate : v.hireDate, row.terminationDate);
      Object.assign(row, v, { updatedAt: stamp() });
      return toDto(row);
    },

    async changeStatus(id, input) {
      await wait();
      const s = getSession();
      need(capabilities(s).canChangeStatus);
      const v = parse(changeEmployeeStatusSchema, input);
      const row = mustFind(s, id);
      const terminationDate = v.status === 'TERMINATED' ? v.terminationDate : null;
      assertDates(row.hireDate, terminationDate);
      Object.assign(row, { status: v.status, terminationDate, updatedAt: stamp() });
      return toDto(row);
    },

    async listDepartments() {
      await wait();
      need(capabilities(getSession()).canListDepartments);
      return [...store.departments].sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
