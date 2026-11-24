import type { ModelMeta, TenantMeta } from './types';

/**
 * Derives model/relation metadata from schema.prisma text. Used by the generator script and by the
 * consistency test only; the runtime reads the generated `meta.generated.ts`.
 * (The Prisma runtime data model does not record whether a relation is to-many.)
 */
export function parseSchemaMeta(schema: string): TenantMeta {
  const lines = schema.split(/\r?\n/);
  const bodies = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start?.[1]) {
      current = [];
      bodies.set(start[1], current);
    } else if (/^\}/.test(line)) {
      current = undefined;
    } else {
      current?.push(line);
    }
  }

  const names = [...bodies.keys()];
  const meta: TenantMeta = {};
  for (const [name, body] of bodies) {
    const model: ModelMeta = { hasCompanyId: false, relations: {} };
    for (const line of body) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('@@') || trimmed.startsWith('//')) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?/.exec(trimmed);
      const fieldName = field?.[1];
      const type = field?.[2];
      if (!fieldName || !type) continue;
      if (fieldName === 'companyId') model.hasCompanyId = true;
      if (names.includes(type))
        model.relations[fieldName] = { target: type, list: Boolean(field?.[3]) };
    }
    meta[name] = model;
  }
  return meta;
}
