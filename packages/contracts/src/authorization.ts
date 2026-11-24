import { PERMISSIONS as P, isRoleKey, type Permission, type RoleKey } from './permissions';

/**
 * The one shared authorisation decision function (PRD section 5: `can(user, action, resource)`).
 * Pure and synchronous: the API resolves facts it needs (is the target in the caller's team? who owns
 * the row?) from the database first and passes them in `resource`. It never reads request input.
 *
 * Fail closed: unknown actions, missing facts and a different `companyId` all return false.
 */

/** The authenticated caller, as established by the validated membership (never by client input). */
export interface AuthzUser {
  userId: string;
  companyId: string;
  employeeId: string | null;
  roles: readonly string[];
  permissions: readonly string[];
}

/** Facts about the thing being acted on. Every field is optional; rules say which they need. */
export interface AuthzResource {
  /** Company that owns the resource. When present it must equal the caller's company. */
  companyId?: string;
  /** Employee the record belongs to (profile, attendance, balance, document owner, leave applicant). */
  ownerEmployeeId?: string | null;
  /** Server-resolved: the owner is a direct or indirect report of the caller. */
  inTeam?: boolean;
  /** Documents: HR has set "Visible to manager". */
  visibleToManager?: boolean;
  /** Accounts: role of the account being acted on. */
  targetRole?: string;
  /** Role changes: the role being assigned. */
  newRole?: string;
  /** Role changes / deactivation: the target is the only remaining active Super Admin. */
  targetIsLastSuperAdmin?: boolean;
  /** Onboarding tasks: who the task is assigned to. */
  assigneeType?: 'HR' | 'EMPLOYEE';
  /** Leave cancellation: the leave has already started. */
  leaveStarted?: boolean;
  /** Leave cancellation: request status. */
  status?: string;
}

export const ACTIONS = [
  'company.read',
  'company.update',
  'org.read',
  'org.write',
  'user.list',
  'user.invite',
  'user.activate',
  'user.assignRole',
  'directory.read',
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.changeStatus',
  'employee.selfUpdate',
  'onboarding.manage',
  'onboarding.completeTask',
  'attendance.checkInOut',
  'attendance.read',
  'attendance.decideCorrection',
  'attendance.manualCorrect',
  'leave.manage',
  'leave.read',
  'leave.apply',
  'leave.decide',
  'leave.cancel',
  'document.read',
  'document.upload',
  'document.manage',
  'companyDocument.read',
  'companyDocument.write',
  'dashboard.admin',
  'dashboard.manager',
  'dashboard.employee',
  'notification.read',
  'audit.read',
] as const;
export type Action = (typeof ACTIONS)[number];

const has = (u: AuthzUser, p: Permission) => u.permissions.includes(p);
const hasRole = (u: AuthzUser, r: RoleKey) => u.roles.includes(r);
const isOwner = (u: AuthzUser, r: AuthzResource) =>
  u.employeeId !== null && r.ownerEmployeeId != null && r.ownerEmployeeId === u.employeeId;

/** all -> any row; team -> `inTeam`; self -> own row. */
function scoped(
  u: AuthzUser,
  r: AuthzResource,
  all: Permission | null,
  team: Permission | null,
  self: Permission | null,
  teamNeedsFlag = false,
): boolean {
  if (all && has(u, all)) return true;
  if (team && has(u, team) && r.inTeam === true && (!teamNeedsFlag || r.visibleToManager === true)) {
    return true;
  }
  return Boolean(self && has(u, self) && isOwner(u, r));
}

/** Approvals: scoped, and nobody ever decides their own request. */
function decide(u: AuthzUser, r: AuthzResource, all: Permission, team: Permission): boolean {
  if (isOwner(u, r)) return false;
  return has(u, all) || (has(u, team) && r.inTeam === true);
}

const RULES: Record<Action, (u: AuthzUser, r: AuthzResource) => boolean> = {
  'company.read': (u) => has(u, P.COMPANY_READ),
  'company.update': (u) => has(u, P.COMPANY_WRITE),
  'org.read': (u) => has(u, P.ORG_READ),
  'org.write': (u) => has(u, P.ORG_WRITE),

  'user.list': (u) => has(u, P.USER_READ),
  // W4: only Super Admin invites HR Admin or Super Admin roles.
  'user.invite': (u, r) =>
    has(u, P.USER_INVITE) &&
    (r.targetRole === undefined ||
      r.targetRole === 'MANAGER' ||
      r.targetRole === 'EMPLOYEE' ||
      hasRole(u, 'SUPER_ADMIN')),
  // AUTH-006: HR cannot touch Super Admin accounts. The last Super Admin can never be deactivated.
  'user.activate': (u, r) =>
    has(u, P.USER_ACTIVATE) &&
    !r.targetIsLastSuperAdmin &&
    (r.targetRole !== 'SUPER_ADMIN' || hasRole(u, 'SUPER_ADMIN')),
  // AUTH-005: only Super Admin assigns roles; the last Super Admin cannot be demoted.
  'user.assignRole': (u, r) =>
    has(u, P.USER_ROLE_WRITE) &&
    (r.newRole === undefined || isRoleKey(r.newRole)) &&
    !(r.targetIsLastSuperAdmin && r.newRole !== undefined && r.newRole !== 'SUPER_ADMIN'),

  'directory.read': (u) => has(u, P.DIRECTORY_READ),
  'employee.read': (u, r) =>
    scoped(u, r, P.EMPLOYEE_READ_ALL, P.EMPLOYEE_READ_TEAM, P.EMPLOYEE_READ_SELF),
  'employee.create': (u) => has(u, P.EMPLOYEE_WRITE),
  'employee.update': (u) => has(u, P.EMPLOYEE_WRITE),
  'employee.changeStatus': (u) => has(u, P.EMPLOYEE_STATUS_WRITE),
  // EMP-009: own contact fields only (even HR edits others through employee.update, not this).
  'employee.selfUpdate': (u, r) => has(u, P.EMPLOYEE_SELF_WRITE) && isOwner(u, r),

  'onboarding.manage': (u) => has(u, P.ONBOARDING_MANAGE),
  // ONB-003: HR completes any task; an employee completes only own tasks assigned to the employee.
  'onboarding.completeTask': (u, r) =>
    has(u, P.ONBOARDING_MANAGE) ||
    (has(u, P.ONBOARDING_OWN_TASKS) && isOwner(u, r) && r.assigneeType === 'EMPLOYEE'),

  // ATT-001: own attendance only, for every role.
  'attendance.checkInOut': (u, r) =>
    has(u, P.ATTENDANCE_SELF) && (r.ownerEmployeeId === undefined || isOwner(u, r)),
  'attendance.read': (u, r) =>
    scoped(u, r, P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM, P.ATTENDANCE_READ_SELF),
  'attendance.decideCorrection': (u, r) =>
    decide(u, r, P.ATTENDANCE_DECIDE_ALL, P.ATTENDANCE_DECIDE_TEAM),
  'attendance.manualCorrect': (u) => has(u, P.ATTENDANCE_MANUAL_WRITE),

  'leave.manage': (u) => has(u, P.LEAVE_MANAGE),
  'leave.read': (u, r) => scoped(u, r, P.LEAVE_READ_ALL, P.LEAVE_READ_TEAM, P.LEAVE_READ_SELF),
  // LEAVE-003: the applicant is always the caller.
  'leave.apply': (u, r) =>
    has(u, P.LEAVE_APPLY) && u.employeeId !== null && (r.ownerEmployeeId === undefined || isOwner(u, r)),
  'leave.decide': (u, r) => decide(u, r, P.LEAVE_DECIDE_ALL, P.LEAVE_DECIDE_TEAM),
  // LEAVE-007: employee cancels Pending, or Approved-not-started, own leave; after start only HR/SA.
  'leave.cancel': (u, r) => {
    if (has(u, P.LEAVE_CANCEL_ANY)) return true;
    if (!isOwner(u, r) || !has(u, P.LEAVE_APPLY)) return false;
    if (r.status === 'PENDING') return true;
    return r.status === 'APPROVED' && r.leaveStarted === false;
  },

  // DOC-004: HR, SA and the owner; managers only when flagged.
  'document.read': (u, r) =>
    scoped(u, r, P.DOCUMENT_READ_ALL, P.DOCUMENT_READ_TEAM, P.DOCUMENT_READ_SELF, true),
  'document.upload': (u, r) => has(u, P.DOCUMENT_UPLOAD_ALL) || (has(u, P.DOCUMENT_UPLOAD_SELF) && isOwner(u, r)),
  'document.manage': (u) => has(u, P.DOCUMENT_MANAGE),
  'companyDocument.read': (u) => has(u, P.COMPANY_DOCUMENT_READ),
  'companyDocument.write': (u) => has(u, P.COMPANY_DOCUMENT_WRITE),

  'dashboard.admin': (u) => has(u, P.DASHBOARD_ADMIN),
  'dashboard.manager': (u) => has(u, P.DASHBOARD_MANAGER),
  'dashboard.employee': (u) => has(u, P.DASHBOARD_EMPLOYEE),
  'notification.read': (u) => has(u, P.NOTIFICATION_SELF),
  'audit.read': (u) => has(u, P.AUDIT_READ),
};

export function can(user: AuthzUser, action: Action, resource: AuthzResource = {}): boolean {
  if (resource.companyId !== undefined && resource.companyId !== user.companyId) return false;
  const rule = RULES[action] as ((u: AuthzUser, r: AuthzResource) => boolean) | undefined;
  return rule ? rule(user, resource) : false;
}
