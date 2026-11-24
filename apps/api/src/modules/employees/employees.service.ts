import {
  PERMISSIONS,
  type ChangeEmployeeStatus,
  type CreateEmployee,
  type Employee,
  type EmployeeListQuery,
  type EmployeeListResponse,
  type EmployeeSelfUpdate,
  type UpdateEmployee,
} from '@gsc/contracts';
import type { AuthenticatedUser } from '../../integrations/central-auth/types';
import { ForbiddenError, NotFoundError } from '../../shared/errors';
import type { EmployeeRepository, EmployeeRow, ReadScope } from './employees.types';

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function invitationStatusOf(row: EmployeeRow): 'NOT_INVITED' | 'INVITED' | 'ACTIVATED' {
  const status = row.membership?.status;
  if (status === 'ACTIVE') return 'ACTIVATED';
  if (status === 'INVITED') return 'INVITED';
  return 'NOT_INVITED';
}

export function toEmployeeDto(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    workEmail: row.workEmail,
    phone: row.phone ?? null,
    address: row.address ?? null,
    emergencyContact: row.emergencyContact ?? null,
    jobTitle: row.jobTitle,
    designation: row.designation ?? null,
    employmentType: row.employmentType,
    status: row.status,
    hireDate: isoDay(row.hireDate),
    joiningDate: isoDay(row.joiningDate ?? row.hireDate),
    terminationDate: isoDay(row.terminationDate),
    exitDate: isoDay(row.exitDate ?? row.terminationDate),
    department: row.department,
    manager: row.manager,
    invitationStatus: invitationStatusOf(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function readScopeFor(user: AuthenticatedUser): ReadScope {
  const has = (p: string) => user.permissions.includes(p);
  if (has(PERMISSIONS.EMPLOYEE_READ_ALL)) return { kind: 'all' };
  const team = has(PERMISSIONS.EMPLOYEE_READ_TEAM);
  const self = has(PERMISSIONS.EMPLOYEE_READ_SELF);
  if (!team && !self) throw new ForbiddenError();
  return { kind: 'limited', employeeId: user.employeeId, team, self };
}

function requirePermission(user: AuthenticatedUser, permission: string): void {
  if (!user.permissions.includes(permission)) throw new ForbiddenError();
}

export function createEmployeeService(repository: EmployeeRepository) {
  const ctx = (user: AuthenticatedUser) => ({ companyId: user.companyId });
  const actor = (user: AuthenticatedUser) => ({ userId: user.userId });

  return {
    async list(user: AuthenticatedUser, query: EmployeeListQuery): Promise<EmployeeListResponse> {
      const page = await repository.list(ctx(user), readScopeFor(user), query);
      return {
        data: page.rows.map(toEmployeeDto),
        page: { limit: query.limit, nextCursor: page.nextCursor },
      };
    },

    async get(user: AuthenticatedUser, id: string): Promise<Employee> {
      const row = await repository.get(ctx(user), readScopeFor(user), id);
      if (!row) throw new NotFoundError('Employee not found');
      return toEmployeeDto(row);
    },

    async create(user: AuthenticatedUser, input: CreateEmployee): Promise<Employee> {
      requirePermission(user, PERMISSIONS.EMPLOYEE_WRITE);
      return toEmployeeDto(await repository.create(ctx(user), actor(user), input));
    },

    async update(user: AuthenticatedUser, id: string, patch: UpdateEmployee): Promise<Employee> {
      requirePermission(user, PERMISSIONS.EMPLOYEE_WRITE);
      return toEmployeeDto(await repository.update(ctx(user), actor(user), id, patch));
    },

    async selfUpdate(user: AuthenticatedUser, patch: EmployeeSelfUpdate): Promise<Employee> {
      if (!user.employeeId) throw new NotFoundError('Employee profile not found');
      requirePermission(user, PERMISSIONS.EMPLOYEE_SELF_EDIT);
      // enforce self scope by targeting own employee id
      return toEmployeeDto(await repository.selfUpdate(ctx(user), actor(user), user.employeeId, patch));
    },

    async changeStatus(user: AuthenticatedUser, id: string, change: ChangeEmployeeStatus): Promise<Employee> {
      requirePermission(user, PERMISSIONS.EMPLOYEE_STATUS_WRITE);
      return toEmployeeDto(await repository.changeStatus(ctx(user), actor(user), id, change));
    },

    async timeline(user: AuthenticatedUser, id: string) {
      return { data: await repository.timeline(ctx(user), readScopeFor(user), id) };
    },

    async sendInvitation(user: AuthenticatedUser, id: string) {
      if (!user.permissions.includes(PERMISSIONS.EMPLOYEE_INVITE) && !user.permissions.includes(PERMISSIONS.USER_ACCOUNT_MANAGE)) {
        throw new ForbiddenError();
      }
      return repository.sendInvitation(ctx(user), actor(user), id);
    },
  };
}

export type EmployeeService = ReturnType<typeof createEmployeeService>;
