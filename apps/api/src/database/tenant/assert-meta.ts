import { tenantMeta } from './meta.generated';
import type { TenantMeta } from './types';

/** Models that are deliberately NOT company-scoped: the tenancy root and global identity. */
const NOT_COMPANY_SCOPED = new Set(['Company', 'User']);
/** Models that must be present and company-scoped; guards against a generator that parses nothing. */
const REQUIRED_SCOPED = ['Employee', 'Department', 'Role', 'RolePermission', 'CompanyMembership'];

/**
 * Fail closed: the tenant layer trusts this metadata, so refuse to start if it looks wrong
 * (empty, missing a core model, or a company-owned model without `companyId`).
 */
export function assertTenantMeta(meta: TenantMeta = tenantMeta): void {
  const problems: string[] = [];
  if (Object.keys(meta).length === 0) problems.push('metadata is empty');
  for (const name of REQUIRED_SCOPED) {
    if (!meta[name]) problems.push(`${name} is missing`);
  }
  for (const [name, model] of Object.entries(meta)) {
    if (!NOT_COMPANY_SCOPED.has(name) && !model.hasCompanyId) {
      problems.push(`${name} has no companyId`);
    }
  }
  if (meta.User?.hasCompanyId) problems.push('User must be global (no companyId)');
  if (problems.length > 0) {
    throw new Error(
      `Tenant metadata is invalid (run \`pnpm db:generate\`): ${problems.join('; ')}`,
    );
  }
}
