import { PERMISSIONS, type Permission, type RoleKey } from '@gsc/contracts';

/**
 * The caller as the UI knows it. In production this comes from a server "who am I" endpoint, which
 * does NOT exist yet (see docs). Until then it is supplied by the DEMO session provider.
 * The UI only hides controls; the API remains the authority and re-checks every request.
 */
export interface Session {
  displayName: string;
  roleKey: RoleKey;
  /** The caller's own employee record, if linked. Needed for "own profile" and team scope. */
  employeeId: string | null;
  permissions: readonly Permission[];
}

export interface Capabilities {
  readAll: boolean;
  readTeam: boolean;
  readSelf: boolean;
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canChangeStatus: boolean;
  /** Department list endpoint requires read-all or write. */
  canListDepartments: boolean;
  /** Filters on department and manager are only meaningful (and permitted) with company-wide read. */
  canUseOrgFilters: boolean;
}

export function capabilities(session: Session): Capabilities {
  const has = (p: Permission) => session.permissions.includes(p);
  const readAll = has(PERMISSIONS.EMPLOYEE_READ_ALL);
  const readTeam = has(PERMISSIONS.EMPLOYEE_READ_TEAM);
  const readSelf = has(PERMISSIONS.EMPLOYEE_READ_SELF);
  const write = has(PERMISSIONS.EMPLOYEE_WRITE);
  return {
    readAll,
    readTeam,
    readSelf,
    canRead: readAll || readTeam || readSelf,
    canCreate: write,
    canEdit: write,
    canChangeStatus: has(PERMISSIONS.EMPLOYEE_STATUS_WRITE),
    canListDepartments: readAll || write,
    canUseOrgFilters: readAll,
  };
}

/** One-line description of what the caller can see, for the directory header. */
export function scopeLabel(c: Capabilities): string {
  if (c.readAll) return 'All employees';
  if (c.readTeam) return 'Your direct reports and your own profile';
  if (c.readSelf) return 'Your own profile';
  return 'No access';
}
