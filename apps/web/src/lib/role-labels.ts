import type { RoleKey } from '@gsc/contracts';

/** Display names for the four fixed roles (PRD SET-003). */
export const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  SUPER_ADMIN: 'Super Admin',
  HR_ADMIN: 'HR Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};
