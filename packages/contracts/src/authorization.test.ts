import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type AuthzUser } from './authorization';
import { ROLE_KEYS, permissionsForRole, type RoleKey } from './permissions';

const user = (role: RoleKey, employeeId: string | null = `emp-${role}`, companyId = 'A'): AuthzUser => ({
  userId: `user-${role}`,
  companyId,
  employeeId,
  roles: [role],
  permissions: permissionsForRole(role),
});
const sa = user('SUPER_ADMIN');
const hr = user('HR_ADMIN');
const mgr = user('MANAGER');
const emp = user('EMPLOYEE');

const other = { ownerEmployeeId: 'someone-else', inTeam: false };
const teamMate = { ownerEmployeeId: 'report-1', inTeam: true };
const own = (u: AuthzUser) => ({ ownerEmployeeId: u.employeeId });

describe('can(): fails closed', () => {
  it('rejects unknown actions and a user with no permissions', () => {
    expect(can(sa, 'nope' as never)).toBe(false);
    const nobody: AuthzUser = { ...emp, roles: [], permissions: [] };
    for (const a of ACTIONS) expect(can(nobody, a, own(nobody))).toBe(false);
  });

  it('rejects any resource from another company, for every role and action', () => {
    for (const role of ROLE_KEYS) {
      const u = user(role);
      for (const a of ACTIONS) expect(can(u, a, { companyId: 'B', ownerEmployeeId: u.employeeId, inTeam: true })).toBe(false);
    }
  });

  it('a user without a linked employee has no own-scope access', () => {
    const noEmp = user('EMPLOYEE', null);
    expect(can(noEmp, 'employee.read', { ownerEmployeeId: null })).toBe(false);
    expect(can(noEmp, 'leave.apply')).toBe(false);
  });
});

describe('can(): employee records', () => {
  it('SA/HR read anyone; MGR only team and self; EMP only self', () => {
    for (const u of [sa, hr]) expect(can(u, 'employee.read', other)).toBe(true);
    expect(can(mgr, 'employee.read', teamMate)).toBe(true);
    expect(can(mgr, 'employee.read', own(mgr))).toBe(true);
    expect(can(mgr, 'employee.read', other)).toBe(false);
    expect(can(emp, 'employee.read', own(emp))).toBe(true);
    expect(can(emp, 'employee.read', teamMate)).toBe(false);
    expect(can(emp, 'employee.read', other)).toBe(false);
  });

  it('only SA/HR create, edit and change status', () => {
    for (const a of ['employee.create', 'employee.update', 'employee.changeStatus'] as const) {
      expect(can(sa, a)).toBe(true);
      expect(can(hr, a)).toBe(true);
      expect(can(mgr, a)).toBe(false);
      expect(can(emp, a)).toBe(false);
    }
  });

  it('self-update is own record only, for every role', () => {
    for (const u of [sa, hr, mgr, emp]) {
      expect(can(u, 'employee.selfUpdate', own(u))).toBe(true);
      expect(can(u, 'employee.selfUpdate', other)).toBe(false);
    }
  });

  it('everyone sees the limited directory', () => {
    for (const u of [sa, hr, mgr, emp]) expect(can(u, 'directory.read')).toBe(true);
  });
});

describe('can(): accounts and roles', () => {
  it('only SA changes roles; HR never does', () => {
    expect(can(sa, 'user.assignRole', { targetRole: 'EMPLOYEE', newRole: 'MANAGER' })).toBe(true);
    for (const u of [hr, mgr, emp]) expect(can(u, 'user.assignRole', { newRole: 'EMPLOYEE' })).toBe(false);
  });

  it('the last Super Admin cannot be demoted, but may keep the role', () => {
    const last = { targetRole: 'SUPER_ADMIN', targetIsLastSuperAdmin: true };
    expect(can(sa, 'user.assignRole', { ...last, newRole: 'HR_ADMIN' })).toBe(false);
    expect(can(sa, 'user.assignRole', { ...last, newRole: 'SUPER_ADMIN' })).toBe(true);
    expect(can(sa, 'user.assignRole', { newRole: 'NOT_A_ROLE' })).toBe(false);
  });

  it('HR may activate/deactivate accounts but never a Super Admin; nobody deactivates the last SA', () => {
    expect(can(hr, 'user.activate', { targetRole: 'EMPLOYEE' })).toBe(true);
    expect(can(hr, 'user.activate', { targetRole: 'SUPER_ADMIN' })).toBe(false);
    expect(can(sa, 'user.activate', { targetRole: 'SUPER_ADMIN' })).toBe(true);
    expect(can(sa, 'user.activate', { targetRole: 'SUPER_ADMIN', targetIsLastSuperAdmin: true })).toBe(false);
    for (const u of [mgr, emp]) expect(can(u, 'user.activate', { targetRole: 'EMPLOYEE' })).toBe(false);
  });

  it('only SA invites HR Admin or Super Admin roles (W4)', () => {
    expect(can(hr, 'user.invite', { targetRole: 'EMPLOYEE' })).toBe(true);
    expect(can(hr, 'user.invite', { targetRole: 'MANAGER' })).toBe(true);
    expect(can(hr, 'user.invite', { targetRole: 'HR_ADMIN' })).toBe(false);
    expect(can(hr, 'user.invite', { targetRole: 'SUPER_ADMIN' })).toBe(false);
    expect(can(sa, 'user.invite', { targetRole: 'HR_ADMIN' })).toBe(true);
    expect(can(mgr, 'user.invite', { targetRole: 'EMPLOYEE' })).toBe(false);
  });

  it('account list: SA/HR only', () => {
    expect(can(sa, 'user.list') && can(hr, 'user.list')).toBe(true);
    expect(can(mgr, 'user.list') || can(emp, 'user.list')).toBe(false);
  });
});

describe('can(): company, organisation and audit', () => {
  it('company settings: SA edits, HR views, others nothing', () => {
    expect(can(sa, 'company.update')).toBe(true);
    expect(can(hr, 'company.update')).toBe(false);
    expect(can(hr, 'company.read')).toBe(true);
    for (const u of [mgr, emp]) expect(can(u, 'company.read') || can(u, 'company.update')).toBe(false);
  });

  it('org data: SA/HR write, everyone views', () => {
    for (const u of [sa, hr, mgr, emp]) expect(can(u, 'org.read')).toBe(true);
    expect(can(sa, 'org.write') && can(hr, 'org.write')).toBe(true);
    expect(can(mgr, 'org.write') || can(emp, 'org.write')).toBe(false);
  });

  it('audit logs: SA only', () => {
    expect(can(sa, 'audit.read')).toBe(true);
    for (const u of [hr, mgr, emp]) expect(can(u, 'audit.read')).toBe(false);
  });
});

describe('can(): attendance', () => {
  it('check-in/out is own attendance only', () => {
    for (const u of [sa, hr, mgr, emp]) {
      expect(can(u, 'attendance.checkInOut', own(u))).toBe(true);
      expect(can(u, 'attendance.checkInOut', other)).toBe(false);
    }
  });

  it('view: SA/HR all, MGR team + self, EMP self', () => {
    expect(can(hr, 'attendance.read', other)).toBe(true);
    expect(can(mgr, 'attendance.read', teamMate)).toBe(true);
    expect(can(mgr, 'attendance.read', other)).toBe(false);
    expect(can(emp, 'attendance.read', own(emp))).toBe(true);
    expect(can(emp, 'attendance.read', teamMate)).toBe(false);
  });

  it('corrections: SA/HR decide any, MGR team only, EMP never; nobody decides their own', () => {
    expect(can(hr, 'attendance.decideCorrection', other)).toBe(true);
    expect(can(mgr, 'attendance.decideCorrection', teamMate)).toBe(true);
    expect(can(mgr, 'attendance.decideCorrection', other)).toBe(false);
    expect(can(emp, 'attendance.decideCorrection', teamMate)).toBe(false);
    for (const u of [sa, hr, mgr]) expect(can(u, 'attendance.decideCorrection', { ...own(u), inTeam: true })).toBe(false);
  });

  it('manual correction: SA/HR only', () => {
    expect(can(sa, 'attendance.manualCorrect') && can(hr, 'attendance.manualCorrect')).toBe(true);
    expect(can(mgr, 'attendance.manualCorrect') || can(emp, 'attendance.manualCorrect')).toBe(false);
  });
});

describe('can(): leave', () => {
  it('apply is for the caller only', () => {
    for (const u of [sa, hr, mgr, emp]) {
      expect(can(u, 'leave.apply', own(u))).toBe(true);
      expect(can(u, 'leave.apply', other)).toBe(false);
    }
  });

  it('decide: SA/HR any, MGR team, EMP never; self-approval blocked for everyone', () => {
    expect(can(sa, 'leave.decide', other) && can(hr, 'leave.decide', other)).toBe(true);
    expect(can(mgr, 'leave.decide', teamMate)).toBe(true);
    expect(can(mgr, 'leave.decide', other)).toBe(false);
    expect(can(emp, 'leave.decide', teamMate)).toBe(false);
    for (const u of [sa, hr, mgr]) expect(can(u, 'leave.decide', { ...own(u), inTeam: true })).toBe(false);
  });

  it('view: SA/HR all, MGR team + self, EMP self', () => {
    expect(can(hr, 'leave.read', other)).toBe(true);
    expect(can(mgr, 'leave.read', teamMate)).toBe(true);
    expect(can(mgr, 'leave.read', other)).toBe(false);
    expect(can(emp, 'leave.read', own(emp))).toBe(true);
    expect(can(emp, 'leave.read', other)).toBe(false);
  });

  it('cancel: employee Pending or Approved-not-started; after start only HR/SA', () => {
    expect(can(emp, 'leave.cancel', { ...own(emp), status: 'PENDING' })).toBe(true);
    expect(can(emp, 'leave.cancel', { ...own(emp), status: 'APPROVED', leaveStarted: false })).toBe(true);
    expect(can(emp, 'leave.cancel', { ...own(emp), status: 'APPROVED', leaveStarted: true })).toBe(false);
    expect(can(emp, 'leave.cancel', { ...own(emp), status: 'APPROVED' })).toBe(false); // unknown start: closed
    expect(can(emp, 'leave.cancel', { ...own(emp), status: 'REJECTED' })).toBe(false);
    expect(can(emp, 'leave.cancel', { ownerEmployeeId: 'someone-else', status: 'PENDING' })).toBe(false);
    expect(can(mgr, 'leave.cancel', { ...teamMate, status: 'PENDING' })).toBe(false);
    for (const u of [sa, hr]) expect(can(u, 'leave.cancel', { ownerEmployeeId: 'x', status: 'APPROVED', leaveStarted: true })).toBe(true);
  });

  it('leave types and balance adjustments: SA/HR only', () => {
    expect(can(sa, 'leave.manage') && can(hr, 'leave.manage')).toBe(true);
    expect(can(mgr, 'leave.manage') || can(emp, 'leave.manage')).toBe(false);
  });
});

describe('can(): onboarding and documents', () => {
  it('HR/SA complete any task; employee only own tasks assigned to the employee; manager none', () => {
    expect(can(hr, 'onboarding.completeTask', { ownerEmployeeId: 'x', assigneeType: 'HR' })).toBe(true);
    expect(can(emp, 'onboarding.completeTask', { ...own(emp), assigneeType: 'EMPLOYEE' })).toBe(true);
    expect(can(emp, 'onboarding.completeTask', { ...own(emp), assigneeType: 'HR' })).toBe(false);
    expect(can(emp, 'onboarding.completeTask', { ownerEmployeeId: 'x', assigneeType: 'EMPLOYEE' })).toBe(false);
    expect(can(mgr, 'onboarding.completeTask', { ...own(mgr), assigneeType: 'EMPLOYEE' })).toBe(false);
    expect(can(mgr, 'onboarding.manage') || can(emp, 'onboarding.manage')).toBe(false);
  });

  it('employee documents: HR/SA any, owner own, manager only team AND flagged', () => {
    expect(can(hr, 'document.read', other) && can(sa, 'document.read', other)).toBe(true);
    expect(can(emp, 'document.read', own(emp))).toBe(true);
    expect(can(emp, 'document.read', other)).toBe(false);
    expect(can(mgr, 'document.read', { ...teamMate, visibleToManager: true })).toBe(true);
    expect(can(mgr, 'document.read', { ...teamMate, visibleToManager: false })).toBe(false);
    expect(can(mgr, 'document.read', teamMate)).toBe(false); // default off
    expect(can(mgr, 'document.read', { ...other, visibleToManager: true })).toBe(false);
    expect(can(mgr, 'document.read', own(mgr))).toBe(true);
  });

  it('upload: HR/SA for anyone, others for themselves only; manage/delete HR/SA only', () => {
    expect(can(hr, 'document.upload', other)).toBe(true);
    expect(can(emp, 'document.upload', own(emp))).toBe(true);
    expect(can(emp, 'document.upload', other)).toBe(false);
    expect(can(mgr, 'document.upload', teamMate)).toBe(false);
    expect(can(sa, 'document.manage') && can(hr, 'document.manage')).toBe(true);
    expect(can(mgr, 'document.manage') || can(emp, 'document.manage')).toBe(false);
  });

  it('company documents: all read, SA/HR write', () => {
    for (const u of [sa, hr, mgr, emp]) expect(can(u, 'companyDocument.read')).toBe(true);
    expect(can(sa, 'companyDocument.write') && can(hr, 'companyDocument.write')).toBe(true);
    expect(can(mgr, 'companyDocument.write') || can(emp, 'companyDocument.write')).toBe(false);
  });
});

describe('can(): dashboards and notifications', () => {
  it('each role sees only its own dashboard kind', () => {
    expect([sa, hr].map((u) => can(u, 'dashboard.admin'))).toEqual([true, true]);
    expect(can(mgr, 'dashboard.manager') && !can(mgr, 'dashboard.admin')).toBe(true);
    expect(can(emp, 'dashboard.employee') && !can(emp, 'dashboard.admin') && !can(emp, 'dashboard.manager')).toBe(true);
    expect(can(sa, 'dashboard.employee')).toBe(false);
  });

  it('everyone reads their notifications', () => {
    for (const u of [sa, hr, mgr, emp]) expect(can(u, 'notification.read')).toBe(true);
  });
});
