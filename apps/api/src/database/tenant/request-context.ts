import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '../generated/client';
import { COMPANY_SETTING } from './tenant-db';

/**
 * Request-scoped tenant context for code that talks to Prisma directly (the settings router) instead of
 * through `withTenant`. `resolveTenant` sets it from the validated ACTIVE membership, never from request
 * input. Postgres Row-Level Security reads `app.company_id`, so every statement issued through the
 * client below carries the caller's company.
 */
const store = new AsyncLocalStorage<{ companyId: string }>();

export const runInTenantContext = <T>(companyId: string, fn: () => T): T => store.run({ companyId }, fn);
export const currentTenantCompanyId = (): string | undefined => store.getStore()?.companyId;

type Delegate = Record<string, (args?: unknown) => unknown>;

/**
 * Wraps a PrismaClient so that every model call, and every interactive `$transaction`, first sets
 * `app.company_id` (transaction-local) from the request context. Without a context the call passes
 * through untouched and RLS returns nothing (fail closed). Call sites do not change.
 */
export function withRequestTenantContext(base: PrismaClient): PrismaClient {
  const setTenant = (tx: { $executeRaw: PrismaClient['$executeRaw'] }, companyId: string) =>
    tx.$executeRaw`SELECT set_config(${COMPANY_SETTING}, ${companyId}, true)`;

  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== 'string') return value;

      if (prop === '$transaction') {
        return (arg: unknown, options?: unknown) => {
          const companyId = currentTenantCompanyId();
          if (typeof arg !== 'function' || !companyId) {
            return (target.$transaction as (...a: unknown[]) => unknown)(arg, options);
          }
          return target.$transaction(async (tx) => {
            await setTenant(tx, companyId);
            return (arg as (t: typeof tx) => unknown)(tx);
          }, options as never);
        };
      }

      if (prop.startsWith('$') || prop.startsWith('_') || typeof value !== 'object' || value === null) {
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }

      // Model delegate (company, employee, auditLog, ...): run each call in a short tenant transaction.
      return new Proxy(value as Delegate, {
        get(delegate, method) {
          const fn = Reflect.get(delegate, method) as unknown;
          if (typeof method !== 'string' || typeof fn !== 'function') return fn;
          return (args?: unknown) => {
            const companyId = currentTenantCompanyId();
            if (!companyId) return (fn as (a?: unknown) => unknown).call(delegate, args);
            return target.$transaction(async (tx) => {
              await setTenant(tx, companyId);
              return (tx as unknown as Record<string, Delegate>)[prop]![method]!(args);
            });
          };
        },
      });
    },
  });
}
