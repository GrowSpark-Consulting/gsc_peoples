import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertTenantMeta } from './assert-meta';
import { tenantMeta } from './meta.generated';
import { parseSchemaMeta } from './parse-schema';

const schema = readFileSync(path.resolve(import.meta.dirname, '../prisma/schema.prisma'), 'utf8');

/**
 * Regression for the generator bug where a regex built in a template literal lost its `\s`
 * escapes, so every model parsed as empty and reported `hasCompanyId: false` (fail-open).
 */
describe('tenant metadata regression', () => {
  const parsed = parseSchemaMeta(schema);

  it.each(['Employee', 'Department', 'Role', 'RolePermission', 'CompanyMembership', 'EmployeeAuditLog'])(
    '%s is company-scoped (parsed from schema and in the generated file)',
    (model) => {
      expect(parsed[model]?.hasCompanyId, `parsed ${model}`).toBe(true);
      expect(tenantMeta[model]?.hasCompanyId, `generated ${model}`).toBe(true);
    },
  );

  it('User is global identity (no companyId)', () => {
    expect(parsed.User?.hasCompanyId).toBe(false);
    expect(tenantMeta.User?.hasCompanyId).toBe(false);
  });

  it('Company is the tenancy root (no companyId of its own)', () => {
    expect(parsed.Company?.hasCompanyId).toBe(false);
  });

  it('relations are parsed (an empty body would yield none)', () => {
    expect(parsed.Company?.relations.memberships).toEqual({ target: 'CompanyMembership', list: true });
    expect(parsed.User?.relations.memberships).toEqual({ target: 'CompanyMembership', list: true });
    expect(parsed.Employee?.relations.department).toEqual({ target: 'Department', list: false });
    expect(parsed.Employee?.relations.reports).toEqual({ target: 'Employee', list: true });
    expect(parsed.EmployeeAuditLog?.relations.employee).toEqual({ target: 'Employee', list: false });
  });

  it('every model in the schema is parsed (none silently skipped)', () => {
    const names = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
    expect(Object.keys(parsed).sort()).toEqual([...names].sort());
  });

  describe('assertTenantMeta fails closed', () => {
    it('accepts the real metadata', () => {
      expect(() => assertTenantMeta(tenantMeta)).not.toThrow();
    });
    it('rejects empty metadata', () => {
      expect(() => assertTenantMeta({})).toThrow(/empty/);
    });
    it('rejects the broken-generator shape (every model hasCompanyId:false)', () => {
      const broken = Object.fromEntries(
        Object.keys(tenantMeta).map((k) => [k, { hasCompanyId: false, relations: {} }]),
      );
      expect(() => assertTenantMeta(broken)).toThrow(/has no companyId/);
    });
    it('rejects a company-owned model without companyId, and a company-scoped User', () => {
      expect(() =>
        assertTenantMeta({ ...tenantMeta, Employee: { hasCompanyId: false, relations: {} } }),
      ).toThrow(/Employee has no companyId/);
      expect(() =>
        assertTenantMeta({ ...tenantMeta, User: { hasCompanyId: true, relations: {} } }),
      ).toThrow(/User must be global/);
    });
  });
});
