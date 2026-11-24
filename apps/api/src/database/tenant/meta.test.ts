import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tenantMeta } from './meta.generated';
import { parseSchemaMeta } from './parse-schema';

const schema = readFileSync(path.resolve(import.meta.dirname, '../prisma/schema.prisma'), 'utf8');

describe('tenant metadata', () => {
  it('meta.generated.ts is up to date with schema.prisma (run `pnpm db:generate`)', () => {
    expect(tenantMeta).toEqual(parseSchemaMeta(schema));
  });

  it('every model except User and Company carries companyId (the tenancy rule)', () => {
    const exceptions = new Set(['User', 'Company']);
    for (const [name, model] of Object.entries(tenantMeta)) {
      if (!exceptions.has(name))
        expect(model.hasCompanyId, `${name} must have companyId`).toBe(true);
    }
    expect(tenantMeta.User?.hasCompanyId).toBe(false);
  });
});
