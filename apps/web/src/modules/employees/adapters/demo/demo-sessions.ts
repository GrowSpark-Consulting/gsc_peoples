import { ROLE_DEFAULT_PERMISSIONS } from '@gsc/contracts';
import type { Session } from '../../permissions';
import { DEMO_IDS } from './demo-data';

/**
 * DEMO personas. Permissions come from the shared registry's recommended role defaults, so the demo
 * behaves like a company provisioned with the default grants. This is NOT authentication.
 */
export const DEMO_PERSONAS = {
  hr: {
    displayName: 'Meera Nair (demo HR Admin)',
    roleKey: 'HR_ADMIN',
    employeeId: DEMO_IDS.hrAdmin,
    permissions: ROLE_DEFAULT_PERMISSIONS.HR_ADMIN,
  },
  manager: {
    displayName: 'Kavya Menon (demo Manager)',
    roleKey: 'MANAGER',
    employeeId: DEMO_IDS.manager,
    permissions: ROLE_DEFAULT_PERMISSIONS.MANAGER,
  },
  employee: {
    displayName: 'Rohan Iyer (demo Employee)',
    roleKey: 'EMPLOYEE',
    employeeId: DEMO_IDS.employee,
    permissions: ROLE_DEFAULT_PERMISSIONS.EMPLOYEE,
  },
} satisfies Record<string, Session>;

export type DemoPersonaKey = keyof typeof DEMO_PERSONAS;
