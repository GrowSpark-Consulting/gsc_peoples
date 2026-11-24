import { normalizeEmail } from '@gsc/shared';
import { ValidationError } from '../../shared/errors';
import type { TenantContext, TenantMeta } from './types';

/**
 * Pure argument rewriting for the tenant-bound database layer. Every rule is unit-tested without a
 * database (scope.test.ts); the live behaviour is covered by the *.integration.test.ts suites.
 */

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantViolationError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `User` is global identity: never a top-level delegate on the tenant client. */
const GLOBAL_MODELS = new Set(['User']);
const TENANT_ROOT = 'Company'; // scoped by `id`; read and update only

/** Fields normalised before every write (backed by CHECK constraints in the database). */
const NORMALIZED_FIELDS: Record<string, Record<string, (v: string) => string>> = {
  Employee: { workEmail: normalizeEmail },
};

const READ_MANY = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const READ_UNIQUE = new Set(['findUnique', 'findUniqueOrThrow']);
const CREATE = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const DELETE = new Set(['delete', 'deleteMany']);
const ROOT_ALLOWED = new Set([...READ_MANY, ...READ_UNIQUE, 'update']);

/** Every operation the tenant layer will forward to Prisma. Anything else is refused. */
export const ALLOWED_OPERATIONS: ReadonlySet<string> = new Set([
  ...READ_MANY,
  ...READ_UNIQUE,
  ...CREATE,
  ...UPDATE,
  ...DELETE,
  'upsert',
]);

const scopeKey = (model: string) => (model === TENANT_ROOT ? 'id' : 'companyId');
const and = (where: unknown, extra: Obj): Obj => ({ AND: [isObj(where) ? where : {}, extra] });

function modelMeta(meta: TenantMeta, name: string) {
  const m = meta[name];
  if (!m) throw new TenantViolationError(`Unknown model ${name}`);
  return m;
}

/** where/orderBy must not reach User -> memberships (existence / ordering oracle). */
function assertSafeFilter(meta: TenantMeta, modelName: string, node: unknown): void {
  if (Array.isArray(node)) return node.forEach((n) => assertSafeFilter(meta, modelName, n));
  if (!isObj(node)) return;
  const model = modelMeta(meta, modelName);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      assertSafeFilter(meta, modelName, value);
      continue;
    }
    const rel = model.relations[key];
    if (!rel) continue; // scalar field or operator
    if (GLOBAL_MODELS.has(modelName)) {
      throw new TenantViolationError(
        `Filtering or ordering ${modelName} by relation "${key}" is not allowed`,
      );
    }
    const wrapped =
      isObj(value) && ['some', 'every', 'none', 'is', 'isNot'].some((k) => k in value)
        ? Object.values(value)
        : [value];
    wrapped.forEach((n) => assertSafeFilter(meta, rel.target, n));
  }
}

/** include/select: inject the company filter on every to-many relation, at every depth. */
function scopeSelection(meta: TenantMeta, ctx: TenantContext, modelName: string, args: Obj): void {
  const model = modelMeta(meta, modelName);
  for (const slot of ['select', 'include'] as const) {
    const sel = args[slot];
    if (!isObj(sel)) continue;
    for (const [key, value] of Object.entries(sel)) {
      if (key === '_count') {
        sel._count = scopeCount(meta, ctx, modelName, value);
        continue;
      }
      const rel = model.relations[key];
      if (!rel || value === false) continue;
      const target = modelMeta(meta, rel.target);
      const opts: Obj = isObj(value) ? { ...value } : {};
      if (rel.list) {
        assertSafeFilter(meta, rel.target, opts.where);
        assertSafeFilter(meta, rel.target, opts.orderBy);
        if (target.hasCompanyId) opts.where = and(opts.where, { companyId: ctx.companyId });
      } else if ('where' in opts) {
        throw new TenantViolationError(`"where" is not allowed on to-one relation "${key}"`);
      }
      scopeSelection(meta, ctx, rel.target, opts);
      sel[key] = Object.keys(opts).length > 0 || rel.list ? opts : true;
    }
  }
}

function scopeCount(meta: TenantMeta, ctx: TenantContext, modelName: string, value: unknown): Obj {
  const model = modelMeta(meta, modelName);
  const given = isObj(value) && isObj(value.select) ? value.select : {};
  const requested =
    value === true
      ? Object.keys(model.relations).filter((r) => model.relations[r]?.list)
      : Object.keys(given);
  const select: Obj = {};
  for (const name of requested) {
    const rel = model.relations[name];
    if (!rel?.list) continue;
    const opts = isObj(given[name]) ? { ...(given[name] as Obj) } : {};
    assertSafeFilter(meta, rel.target, opts.where);
    select[name] = modelMeta(meta, rel.target).hasCompanyId
      ? { ...opts, where: and(opts.where, { companyId: ctx.companyId }) }
      : opts;
  }
  return { select };
}

function normalizeFields(modelName: string, data: Obj): Obj {
  const rules = NORMALIZED_FIELDS[modelName];
  if (!rules) return data;
  const out = { ...data };
  for (const [field, normalize] of Object.entries(rules)) {
    const current = out[field];
    try {
      if (typeof current === 'string') out[field] = normalize(current);
      else if (isObj(current) && typeof current.set === 'string')
        out[field] = { ...current, set: normalize(current.set) };
    } catch {
      throw new ValidationError(`Invalid value for ${modelName}.${field}`);
    }
  }
  return out;
}

function assertNoRelationData(
  meta: TenantMeta,
  modelName: string,
  data: unknown,
  what: string,
): Obj {
  if (!isObj(data)) throw new TenantViolationError(`${what}: data must be an object`);
  const model = modelMeta(meta, modelName);
  for (const key of Object.keys(data)) {
    if (model.relations[key]) {
      throw new TenantViolationError(
        `${what}: nested relation write "${key}" is not allowed; use scalar foreign keys`,
      );
    }
  }
  return data;
}

function scopeCreateData(
  meta: TenantMeta,
  ctx: TenantContext,
  modelName: string,
  data: unknown,
): Obj {
  const d = assertNoRelationData(meta, modelName, data, 'create');
  if ('id' in d)
    throw new TenantViolationError('Client-supplied id is not allowed; ids are server-generated');
  if ('companyId' in d && d.companyId !== ctx.companyId)
    throw new TenantViolationError('companyId mismatch in create data');
  return { ...normalizeFields(modelName, d), companyId: ctx.companyId };
}

function scopeUpdateData(meta: TenantMeta, modelName: string, data: unknown): Obj {
  const d = assertNoRelationData(meta, modelName, data, 'update');
  if ('companyId' in d) throw new TenantViolationError('companyId is immutable');
  if ('id' in d) throw new TenantViolationError('id is immutable');
  return normalizeFields(modelName, d);
}

function scopeUniqueWhere(modelName: string, ctx: TenantContext, where: unknown): Obj {
  const key = scopeKey(modelName);
  const w = isObj(where) ? where : {};
  if (key in w && w[key] !== ctx.companyId) {
    throw new TenantViolationError(`${key} in unique where does not match the tenant`);
  }
  return { ...w, [key]: ctx.companyId };
}

export function scopeOperation(
  meta: TenantMeta,
  ctx: TenantContext,
  modelName: string,
  operation: string,
  input: unknown,
): Obj {
  if (!ctx.companyId) throw new TenantViolationError('Missing tenant context');
  if (GLOBAL_MODELS.has(modelName)) {
    throw new TenantViolationError(
      `${modelName} is global identity data and is not available on the tenant client`,
    );
  }
  const model = modelMeta(meta, modelName);
  if (modelName === TENANT_ROOT && !ROOT_ALLOWED.has(operation)) {
    throw new TenantViolationError(
      `Operation ${operation} on Company is not allowed on the tenant client`,
    );
  }
  if (modelName !== TENANT_ROOT && !model.hasCompanyId) {
    throw new TenantViolationError(
      `${modelName} has no companyId and cannot be used on the tenant client`,
    );
  }
  const args: Obj = isObj(input) ? structuredClone(input) : {};
  const key = scopeKey(modelName);

  assertSafeFilter(meta, modelName, args.where);
  assertSafeFilter(meta, modelName, args.orderBy);

  if (READ_UNIQUE.has(operation)) {
    args.where = scopeUniqueWhere(modelName, ctx, args.where);
  } else if (READ_MANY.has(operation)) {
    args.where = and(args.where, { [key]: ctx.companyId });
    if (isObj(args.cursor)) args.cursor = scopeUniqueWhere(modelName, ctx, args.cursor);
  } else if (CREATE.has(operation)) {
    args.data = Array.isArray(args.data)
      ? args.data.map((row) => scopeCreateData(meta, ctx, modelName, row))
      : scopeCreateData(meta, ctx, modelName, args.data);
  } else if (UPDATE.has(operation)) {
    args.data = scopeUpdateData(meta, modelName, args.data);
    args.where =
      operation === 'update'
        ? scopeUniqueWhere(modelName, ctx, args.where)
        : and(args.where, { [key]: ctx.companyId });
  } else if (operation === 'upsert') {
    args.where = scopeUniqueWhere(modelName, ctx, args.where);
    args.create = scopeCreateData(meta, ctx, modelName, args.create);
    args.update = scopeUpdateData(meta, modelName, args.update);
  } else if (DELETE.has(operation)) {
    args.where =
      operation === 'delete'
        ? scopeUniqueWhere(modelName, ctx, args.where)
        : and(args.where, { [key]: ctx.companyId });
  } else {
    throw new TenantViolationError(`Operation ${operation} is not supported on the tenant client`);
  }

  scopeSelection(meta, ctx, modelName, args);
  return args;
}
