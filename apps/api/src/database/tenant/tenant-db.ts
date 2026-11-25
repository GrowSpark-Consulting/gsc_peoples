/* eslint-disable @typescript-eslint/no-explicit-any -- the tenant facade returns untyped rows (database/tenant/tenant-db.ts) */
import { Prisma, type PrismaClient } from '../generated/client';
import { tenantMeta } from './meta.generated';
import { ALLOWED_OPERATIONS, scopeOperation, TenantViolationError } from './scope';
import type { TenantContext } from './types';

/** Company-owned delegates exposed to application code. `user` and every raw method are absent. */
const DELEGATES = {
  company: 'Company',
  role: 'Role',
  rolePermission: 'RolePermission',
  department: 'Department',
  designation: 'Designation',
  holiday: 'Holiday',
  employeeNumberSequence: 'EmployeeNumberSequence',
  companyMembership: 'CompanyMembership',
  employee: 'Employee',
  employeeAuditLog: 'EmployeeAuditLog',
  onboardingTemplateTask: 'OnboardingTemplateTask',
  onboardingTask: 'OnboardingTask',
  attendanceRecord: 'AttendanceRecord',
  attendanceCorrection: 'AttendanceCorrection',
  leaveType: 'LeaveType',
  leaveBalance: 'LeaveBalance',
  leaveRequest: 'LeaveRequest',
  employeeDocument: 'EmployeeDocument',
  notification: 'Notification',
  userSession: 'UserSession',
  passwordResetToken: 'PasswordResetToken',
  invitationToken: 'InvitationToken',
  auditLog: 'AuditLog',
} as const;

type DelegateKey = keyof typeof DELEGATES;

/** Company-scoped delegate facade used by repositories/routes. */
export type TenantDb = Record<DelegateKey, any>;

export type TenantRunner = <T>(
  ctx: TenantContext,
  fn: (db: TenantDb, tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

/** Setting read by (future) row-level-security policies: `current_setting('app.company_id', true)`. */
export const COMPANY_SETTING = 'app.company_id';

function scopeClient(tx: Prisma.TransactionClient, ctx: TenantContext): TenantDb {
  const facade: Record<string, unknown> = {};
  for (const [key, modelName] of Object.entries(DELEGATES) as [DelegateKey, string][]) {
    const delegate = (tx as unknown as Record<string, Record<string, (a?: unknown) => unknown>>)[
      key
    ];
    facade[key] = new Proxy(
      {},
      {
        get(_target, operation) {
          if (typeof operation !== 'string' || !ALLOWED_OPERATIONS.has(operation)) {
            throw new TenantViolationError(
              `Operation "${String(operation)}" is not available on the tenant client`,
            );
          }
          // Violations surface as rejected promises (never synchronous throws), like any Prisma error.
          return (args?: unknown) => {
            try {
              return delegate?.[operation]?.(
                scopeOperation(tenantMeta, ctx, modelName, operation, args),
              );
            } catch (error) {
              return Promise.reject(error);
            }
          };
        },
      },
    );
  }
  return facade as TenantDb;
}

/** Runs `fn` inside a tenant-bound interactive transaction with `app.company_id` set locally. */
export function createTenantRunner(prisma: PrismaClient): TenantRunner {
  return async <T>(
    ctx: TenantContext,
    fn: (db: TenantDb, tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => {
    if (!ctx.companyId) throw new TenantViolationError('Missing tenant context');
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config(${COMPANY_SETTING}, ${ctx.companyId}, true)`;
        return fn(scopeClient(tx, ctx), tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  };
}
