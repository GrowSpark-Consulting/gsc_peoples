import {
  PERMISSIONS,
  type ChangeEmployeeStatus,
  type CreateEmployee,
  type DirectoryQuery,
  type Employee,
  type EmployeeListQuery,
  type EmployeeListResponse,
  type EmployeeSelfUpdate,
  type RoleKey,
  type UpdateEmployee,
} from '@gsc/contracts';
import type { AuthenticatedUser } from '../../integrations/central-auth/types';
import { ForbiddenError, NotFoundError, ServiceUnavailableError } from '../../shared/errors';
import type { InvitationService } from '../auth/invitations';
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

/** PRD section 5 privacy: address and emergency contact are visible only to HR, Super Admin and the owner. */
const PRIVATE_FIELDS = ['address', 'emergencyContact'] as const;
export const maySeePrivate = (user: AuthenticatedUser, employeeId: string) =>
  user.permissions.includes(PERMISSIONS.EMPLOYEE_READ_ALL) || user.employeeId === employeeId;

function forViewer(user: AuthenticatedUser, dto: Employee): Employee {
  return maySeePrivate(user, dto.id) ? dto : { ...dto, address: null, emergencyContact: null };
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

export function createEmployeeService(repository: EmployeeRepository, invitations?: InvitationService) {
  const ctx = (user: AuthenticatedUser) => ({ companyId: user.companyId });
  const actor = (user: AuthenticatedUser) => ({ userId: user.userId, isSuperAdmin: user.roles.includes('SUPER_ADMIN') });

  return {
    async list(user: AuthenticatedUser, query: EmployeeListQuery): Promise<EmployeeListResponse> {
      const page = await repository.list(ctx(user), readScopeFor(user), query);
      return {
        data: page.rows.map((row) => forViewer(user, toEmployeeDto(row))),
        page: { limit: query.limit, nextCursor: page.nextCursor },
      };
    },

    async get(user: AuthenticatedUser, id: string): Promise<Employee> {
      const row = await repository.get(ctx(user), readScopeFor(user), id);
      if (!row) throw new NotFoundError('Employee not found');
      return forViewer(user, toEmployeeDto(row));
    },

    async directory(user: AuthenticatedUser, query: DirectoryQuery) {
      requirePermission(user, PERMISSIONS.DIRECTORY_READ);
      const { rows, total } = await repository.directory(ctx(user), query);
      return {
        data: rows.map((r) => ({
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          title: r.designation?.name ?? r.jobTitle,
          departmentName: r.department?.name ?? null,
          workEmail: r.workEmail,
        })),
        page: { page: query.page, pageSize: query.pageSize, total },
      };
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
      const entries = await repository.timeline(ctx(user), readScopeFor(user), id);
      if (maySeePrivate(user, id)) return { data: entries };
      return {
        data: entries.map((e) => ({
          ...e,
          changes: Object.fromEntries(Object.entries(e.changes ?? {}).filter(([field]) => !(PRIVATE_FIELDS as readonly string[]).includes(field))),
        })),
      };
    },

    async sendInvitation(user: AuthenticatedUser, id: string, roleKey?: RoleKey) {
      if (!user.permissions.includes(PERMISSIONS.EMPLOYEE_INVITE) && !user.permissions.includes(PERMISSIONS.USER_ACCOUNT_MANAGE)) {
        throw new ForbiddenError();
      }
      if (!invitations) throw new ServiceUnavailableError('Invitations are not available without a database');
      return invitations.issue({ companyId: user.companyId, actorUserId: user.userId, actorIsSuperAdmin: user.roles.includes('SUPER_ADMIN'), employeeId: id, roleKey });
    },
  };
}

export type EmployeeService = ReturnType<typeof createEmployeeService>;
