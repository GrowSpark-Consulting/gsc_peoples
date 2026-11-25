import type {
  ChangeEmployeeStatus,
  CreateEmployee,
  DirectoryQuery,
  EmployeeListQuery,
  EmployeeSelfUpdate,
  EmploymentStatus,
  EmploymentType,
  UpdateEmployee,
} from '@gsc/contracts';
import type { TenantContext } from '../../database/tenant/types';

/** Row shape returned by the repository (dates still `Date`; the service maps to the API shape). */
export interface EmployeeRow {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  phone: string | null;
  address: string | null;
  emergencyContact: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  hireDate: Date | null;
  joiningDate: Date | null;
  terminationDate: Date | null;
  exitDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  manager: { id: string; employeeNumber: string; firstName: string; lastName: string } | null;
  membership?: { status: string; userId: string } | null;
}

/**
 * Which employee rows the caller may read inside their company.
 *  - all:     employee:read:all
 *  - limited: employee:read:team (direct reports only) and/or employee:read:self (own record),
 *             both resolved from the caller's membership `employeeId`.
 */
export type ReadScope =
  | { kind: 'all' }
  | { kind: 'limited'; employeeId: string | null; team: boolean; self: boolean };

export interface Actor {
  userId: string;
  /** Some employee changes are Super Admin only (employee ID, joining date, offboarding a Super Admin). */
  isSuperAdmin: boolean;
}

export interface DirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  jobTitle: string | null;
  department: { name: string } | null;
  designation: { name: string } | null;
}

export interface EmployeePage {
  rows: EmployeeRow[];
  nextCursor: string | null;
}

export interface TimelineEntry {
  id: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  changes?: Record<string, unknown>;
  actor?: { id: string | null; name?: string | null };
  timestamp: string;
}

/** Every method takes the tenant context first; there is no way to call one without a company. */
export interface EmployeeRepository {
  list(ctx: TenantContext, scope: ReadScope, query: EmployeeListQuery): Promise<EmployeePage>;
  get(ctx: TenantContext, scope: ReadScope, id: string): Promise<EmployeeRow | null>;
  create(ctx: TenantContext, actor: Actor, input: CreateEmployee): Promise<EmployeeRow>;
  update(ctx: TenantContext, actor: Actor, id: string, patch: UpdateEmployee): Promise<EmployeeRow>;
  selfUpdate(ctx: TenantContext, actor: Actor, id: string, patch: EmployeeSelfUpdate): Promise<EmployeeRow>;
  changeStatus(
    ctx: TenantContext,
    actor: Actor,
    id: string,
    change: ChangeEmployeeStatus,
  ): Promise<EmployeeRow>;
  timeline(ctx: TenantContext, scope: ReadScope, id: string): Promise<TimelineEntry[]>;
  directory(ctx: TenantContext, query: DirectoryQuery): Promise<{ rows: DirectoryRow[]; total: number }>;
}
