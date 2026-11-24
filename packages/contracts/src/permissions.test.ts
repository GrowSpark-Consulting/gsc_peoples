import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  dashboardForRole,
  isPermission,
  permissionsForRole,
} from './permissions';

describe('permission registry', () => {
  it('has unique, namespaced permission strings', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z-]+:[a-z-]+(:[a-z]+)?$/);
  });

  it('keeps the original employee permissions', () => {
    for (const p of [
      'employee:read:all',
      'employee:read:team',
      'employee:read:self',
      'employee:write',
      'employee:status:write',
    ])
      expect(isPermission(p)).toBe(true);
  });

  it('isPermission rejects anything outside the registry', () => {
    expect(isPermission('employee:write')).toBe(true);
    expect(isPermission('employee:*')).toBe(false);
    expect(isPermission('')).toBe(false);
  });

  it('every role grants only registered permissions, with no duplicates dropped silently', () => {
    for (const role of ROLE_KEYS) {
      for (const p of ROLE_PERMISSIONS[role]) expect(isPermission(p)).toBe(true);
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }
  });

  it('unknown role keys get no permissions (fail closed)', () => {
    expect(permissionsForRole('ROOT')).toEqual([]);
    expect(permissionsForRole('')).toEqual([]);
  });
});

describe('PRD section 5 matrix, by role', () => {
  const sa = new Set(permissionsForRole('SUPER_ADMIN'));
  const hr = new Set(permissionsForRole('HR_ADMIN'));
  const mgr = new Set(permissionsForRole('MANAGER'));
  const emp = new Set(permissionsForRole('EMPLOYEE'));

  it('company settings: SA full, HR view, others none', () => {
    expect(sa.has(PERMISSIONS.COMPANY_WRITE) && sa.has(PERMISSIONS.COMPANY_READ)).toBe(true);
    expect(hr.has(PERMISSIONS.COMPANY_READ)).toBe(true);
    expect(hr.has(PERMISSIONS.COMPANY_WRITE)).toBe(false);
    for (const s of [mgr, emp]) {
      expect(s.has(PERMISSIONS.COMPANY_READ)).toBe(false);
      expect(s.has(PERMISSIONS.COMPANY_WRITE)).toBe(false);
    }
  });

  it('departments, designations, holidays: SA/HR full, MGR/EMP view', () => {
    for (const s of [sa, hr]) expect(s.has(PERMISSIONS.ORG_WRITE)).toBe(true);
    for (const s of [sa, hr, mgr, emp]) expect(s.has(PERMISSIONS.ORG_READ)).toBe(true);
    for (const s of [mgr, emp]) expect(s.has(PERMISSIONS.ORG_WRITE)).toBe(false);
  });

  it('roles and account activation: SA full, HR activate only', () => {
    expect(sa.has(PERMISSIONS.USER_ROLE_WRITE)).toBe(true);
    expect(hr.has(PERMISSIONS.USER_ROLE_WRITE)).toBe(false);
    expect(hr.has(PERMISSIONS.USER_ACTIVATE)).toBe(true);
    for (const s of [mgr, emp]) {
      expect(s.has(PERMISSIONS.USER_ACTIVATE)).toBe(false);
      expect(s.has(PERMISSIONS.USER_READ)).toBe(false);
    }
  });

  it('employee create/edit/deactivate: SA and HR only', () => {
    for (const s of [sa, hr]) {
      expect(s.has(PERMISSIONS.EMPLOYEE_WRITE)).toBe(true);
      expect(s.has(PERMISSIONS.EMPLOYEE_STATUS_WRITE)).toBe(true);
    }
    for (const s of [mgr, emp]) {
      expect(s.has(PERMISSIONS.EMPLOYEE_WRITE)).toBe(false);
      expect(s.has(PERMISSIONS.EMPLOYEE_STATUS_WRITE)).toBe(false);
    }
  });

  it('employee profile: SA/HR all, MGR team, EMP own; everyone may self-edit contact fields', () => {
    expect(sa.has(PERMISSIONS.EMPLOYEE_READ_ALL) && hr.has(PERMISSIONS.EMPLOYEE_READ_ALL)).toBe(true);
    expect(mgr.has(PERMISSIONS.EMPLOYEE_READ_TEAM)).toBe(true);
    expect(mgr.has(PERMISSIONS.EMPLOYEE_READ_ALL)).toBe(false);
    expect(emp.has(PERMISSIONS.EMPLOYEE_READ_SELF)).toBe(true);
    expect(emp.has(PERMISSIONS.EMPLOYEE_READ_ALL) || emp.has(PERMISSIONS.EMPLOYEE_READ_TEAM)).toBe(false);
    for (const s of [sa, hr, mgr, emp]) {
      expect(s.has(PERMISSIONS.EMPLOYEE_SELF_WRITE)).toBe(true);
      expect(s.has(PERMISSIONS.DIRECTORY_READ)).toBe(true);
    }
  });

  it('onboarding: SA/HR manage, EMP own tasks, MGR none', () => {
    for (const s of [sa, hr]) expect(s.has(PERMISSIONS.ONBOARDING_MANAGE)).toBe(true);
    expect(emp.has(PERMISSIONS.ONBOARDING_OWN_TASKS)).toBe(true);
    expect(emp.has(PERMISSIONS.ONBOARDING_MANAGE)).toBe(false);
    expect(mgr.has(PERMISSIONS.ONBOARDING_MANAGE) || mgr.has(PERMISSIONS.ONBOARDING_OWN_TASKS)).toBe(false);
  });

  it('attendance: everyone checks in; view full/full/team/own; approve full/full/team/none; manual SA/HR', () => {
    for (const s of [sa, hr, mgr, emp]) expect(s.has(PERMISSIONS.ATTENDANCE_SELF)).toBe(true);
    for (const s of [sa, hr]) {
      expect(s.has(PERMISSIONS.ATTENDANCE_READ_ALL)).toBe(true);
      expect(s.has(PERMISSIONS.ATTENDANCE_DECIDE_ALL)).toBe(true);
      expect(s.has(PERMISSIONS.ATTENDANCE_MANUAL_WRITE)).toBe(true);
    }
    expect(mgr.has(PERMISSIONS.ATTENDANCE_READ_TEAM) && mgr.has(PERMISSIONS.ATTENDANCE_DECIDE_TEAM)).toBe(true);
    expect(mgr.has(PERMISSIONS.ATTENDANCE_READ_ALL) || mgr.has(PERMISSIONS.ATTENDANCE_MANUAL_WRITE)).toBe(false);
    expect(emp.has(PERMISSIONS.ATTENDANCE_READ_SELF)).toBe(true);
    expect(emp.has(PERMISSIONS.ATTENDANCE_DECIDE_TEAM) || emp.has(PERMISSIONS.ATTENDANCE_DECIDE_ALL)).toBe(false);
  });

  it('leave: types/balances SA/HR manage, MGR view team, EMP own; approve full/full/team/none', () => {
    for (const s of [sa, hr]) {
      expect(s.has(PERMISSIONS.LEAVE_MANAGE) && s.has(PERMISSIONS.LEAVE_DECIDE_ALL)).toBe(true);
    }
    expect(mgr.has(PERMISSIONS.LEAVE_READ_TEAM) && mgr.has(PERMISSIONS.LEAVE_DECIDE_TEAM)).toBe(true);
    expect(mgr.has(PERMISSIONS.LEAVE_MANAGE)).toBe(false);
    expect(emp.has(PERMISSIONS.LEAVE_DECIDE_TEAM) || emp.has(PERMISSIONS.LEAVE_DECIDE_ALL)).toBe(false);
    for (const s of [sa, hr, mgr, emp]) expect(s.has(PERMISSIONS.LEAVE_APPLY)).toBe(true);
    expect(sa.has(PERMISSIONS.LEAVE_CANCEL_ANY) && hr.has(PERMISSIONS.LEAVE_CANCEL_ANY)).toBe(true);
    expect(mgr.has(PERMISSIONS.LEAVE_CANCEL_ANY) || emp.has(PERMISSIONS.LEAVE_CANCEL_ANY)).toBe(false);
  });

  it('documents: SA/HR full, MGR only when flagged, EMP own; company docs upload SA/HR, view all', () => {
    for (const s of [sa, hr]) {
      expect(s.has(PERMISSIONS.DOCUMENT_READ_ALL) && s.has(PERMISSIONS.DOCUMENT_MANAGE)).toBe(true);
      expect(s.has(PERMISSIONS.COMPANY_DOCUMENT_WRITE)).toBe(true);
    }
    expect(mgr.has(PERMISSIONS.DOCUMENT_READ_TEAM)).toBe(true);
    expect(mgr.has(PERMISSIONS.DOCUMENT_READ_ALL)).toBe(false);
    expect(emp.has(PERMISSIONS.DOCUMENT_READ_SELF)).toBe(true);
    for (const s of [mgr, emp]) expect(s.has(PERMISSIONS.COMPANY_DOCUMENT_WRITE)).toBe(false);
    for (const s of [sa, hr, mgr, emp]) expect(s.has(PERMISSIONS.COMPANY_DOCUMENT_READ)).toBe(true);
  });

  it('dashboards and audit logs', () => {
    expect(sa.has(PERMISSIONS.DASHBOARD_ADMIN) && hr.has(PERMISSIONS.DASHBOARD_ADMIN)).toBe(true);
    expect(mgr.has(PERMISSIONS.DASHBOARD_MANAGER) && !mgr.has(PERMISSIONS.DASHBOARD_ADMIN)).toBe(true);
    expect(emp.has(PERMISSIONS.DASHBOARD_EMPLOYEE) && !emp.has(PERMISSIONS.DASHBOARD_ADMIN)).toBe(true);
    expect(sa.has(PERMISSIONS.AUDIT_READ)).toBe(true);
    for (const s of [hr, mgr, emp]) expect(s.has(PERMISSIONS.AUDIT_READ)).toBe(false);
  });

  it('dashboardForRole maps roles to the three dashboards', () => {
    expect(dashboardForRole('SUPER_ADMIN')).toBe('admin');
    expect(dashboardForRole('HR_ADMIN')).toBe('admin');
    expect(dashboardForRole('MANAGER')).toBe('manager');
    expect(dashboardForRole('EMPLOYEE')).toBe('employee');
    expect(dashboardForRole('x')).toBeNull();
  });
});
