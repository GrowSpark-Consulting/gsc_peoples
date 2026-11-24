import { ROLE_DEFAULT_PERMISSIONS } from '@gsc/contracts';
import { describe, expect, it } from 'vitest';
import { DEMO_PERSONAS } from './adapters/demo/demo-sessions';
import { capabilities, scopeLabel } from './permissions';

describe('capabilities (from the shared permission registry)', () => {
  it('HR Admin: all employees, create, edit and change status', () => {
    const c = capabilities(DEMO_PERSONAS.hr);
    expect(c).toMatchObject({
      readAll: true,
      canCreate: true,
      canEdit: true,
      canChangeStatus: true,
      canListDepartments: true,
      canUseOrgFilters: true,
    });
    expect(scopeLabel(c)).toBe('All employees');
  });

  it('Manager: direct reports and own profile, strictly read-only', () => {
    const c = capabilities(DEMO_PERSONAS.manager);
    expect(c).toMatchObject({
      readAll: false,
      readTeam: true,
      readSelf: true,
      canCreate: false,
      canEdit: false,
      canChangeStatus: false,
      canListDepartments: false,
      canUseOrgFilters: false,
    });
    expect(scopeLabel(c)).toMatch(/direct reports/i);
  });

  it('Employee: own profile only, read-only', () => {
    const c = capabilities(DEMO_PERSONAS.employee);
    expect(c).toMatchObject({
      readAll: false,
      readTeam: false,
      readSelf: true,
      canCreate: false,
      canEdit: false,
      canChangeStatus: false,
    });
    expect(scopeLabel(c)).toBe('Your own profile');
  });

  it('no permissions means no access', () => {
    const c = capabilities({
      displayName: 'x',
      roleKey: 'EMPLOYEE',
      employeeId: null,
      permissions: [],
    });
    expect(c.canRead).toBe(false);
    expect(scopeLabel(c)).toBe('No access');
  });

  it('personas use exactly the registry defaults', () => {
    expect(DEMO_PERSONAS.hr.permissions).toBe(ROLE_DEFAULT_PERMISSIONS.HR_ADMIN);
    expect(DEMO_PERSONAS.manager.permissions).toBe(ROLE_DEFAULT_PERMISSIONS.MANAGER);
    expect(DEMO_PERSONAS.employee.permissions).toBe(ROLE_DEFAULT_PERMISSIONS.EMPLOYEE);
  });
});
