import type { Prisma } from '../../database/generated/client';
import type { TenantDb } from '../../database/tenant';

/**
 * One append-only audit row (PRD global rule: every state change is audit-logged, with actor, action, entity,
 * old and new values, time). Always call it with the SAME tenant transaction as the change, so a change can
 * never exist without its audit row and a rolled-back change leaves none. `companyId` is injected by the
 * tenant layer. Never put passwords, tokens or file contents in the values.
 */
export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Dates and other class instances become their JSON form; `undefined` members are dropped. */
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

export async function recordAudit(db: TenantDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      ...(entry.oldValue === undefined || entry.oldValue === null ? {} : { oldValue: json(entry.oldValue) }),
      ...(entry.newValue === undefined || entry.newValue === null ? {} : { newValue: json(entry.newValue) }),
    },
  });
}
