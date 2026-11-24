import { getPrisma } from '../client';
import { createTenantRunner, type TenantRunner } from './tenant-db';

export { createTenantRunner, COMPANY_SETTING, type TenantDb, type TenantRunner } from './tenant-db';
export { TenantViolationError } from './scope';
export type { TenantContext } from './types';

/** The application entry point for company-owned data. */
export const withTenant: TenantRunner = (ctx, fn) =>
  createTenantRunner(getPrisma())(ctx, fn);
