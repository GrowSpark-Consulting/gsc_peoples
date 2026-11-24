import { z } from 'zod';
import {
  employmentStatusSchema,
  employmentTypeSchema,
  type EmployeeListQueryInput,
  type EmploymentStatus,
  type EmploymentType,
} from '@gsc/contracts';

export interface ManagerOption {
  id: string;
  /** "First Last · GS-0001" */
  label: string;
}

export interface DirectoryFilters {
  q: string;
  /** Any of these statuses (empty = no filter). The API accepts a list. */
  status: EmploymentStatus[];
  /** Any of these employment types (empty = no filter). The API accepts a list. */
  employmentType: EmploymentType[];
  departmentId: string;
  manager: ManagerOption | null;
}

export const EMPTY_FILTERS: DirectoryFilters = {
  q: '',
  status: [],
  employmentType: [],
  departmentId: '',
  manager: null,
};

export const hasActiveFilters = (f: DirectoryFilters) =>
  Boolean(
    f.q.trim() || f.status.length || f.employmentType.length || f.departmentId || f.manager,
  );

export function toListQuery(
  f: DirectoryFilters,
  opts: { limit: number; cursor?: string },
): EmployeeListQueryInput {
  return {
    limit: opts.limit,
    ...(opts.cursor ? { cursor: opts.cursor } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.status.length ? { status: f.status } : {}),
    ...(f.employmentType.length ? { employmentType: f.employmentType } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.manager ? { managerId: f.manager.id } : {}),
  };
}

/** "ACTIVE,ON_LEAVE" -> valid values only, no duplicates, in the schema's canonical order. */
function parseList<T extends string>(raw: string | null, schema: z.ZodEnum<{ [k: string]: T }>): T[] {
  const wanted = new Set((raw ?? '').split(',').map((s) => s.trim()));
  return schema.options.filter((o) => wanted.has(o));
}

/** URL state, so a filtered view survives navigation to a profile and back, and can be shared. */
export function filtersFromSearchParams(sp: URLSearchParams): DirectoryFilters {
  // Ids from the URL are untrusted: a malformed one must be ignored, not sent to the API.
  const isUuid = (v: string | null): v is string => v !== null && z.uuid().safeParse(v).success;
  const managerParam = sp.get('manager');
  const managerId = isUuid(managerParam) ? managerParam : null;
  const deptParam = sp.get('dept');
  return {
    q: sp.get('q') ?? '',
    status: parseList(sp.get('status'), employmentStatusSchema),
    employmentType: parseList(sp.get('type'), employmentTypeSchema),
    departmentId: isUuid(deptParam) ? deptParam : '',
    manager: managerId
      ? { id: managerId, label: sp.get('managerName') ?? 'Selected manager' }
      : null,
  };
}

export function filtersToSearchParams(f: DirectoryFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.status.length) p.set('status', f.status.join(','));
  if (f.employmentType.length) p.set('type', f.employmentType.join(','));
  if (f.departmentId) p.set('dept', f.departmentId);
  if (f.manager) {
    p.set('manager', f.manager.id);
    p.set('managerName', f.manager.label);
  }
  return p;
}
