import { RETENTION_DAYS, type PurgeLogger, type PurgeResult } from '../documents/retention';
import type { TenantRunner } from '../../database/tenant';
import type { DocumentStorage } from '../../integrations/storage';

export interface IdentityPurgeOptions {
  companyId: string;
  runner: TenantRunner;
  /** The DEDICATED identity-document storage, never the general documents bucket. */
  storage: DocumentStorage;
  now?: Date;
  limit?: number;
  dryRun?: boolean;
  log: PurgeLogger;
}

/**
 * Permanently removes identity documents that were deleted or replaced more than RETENTION_DAYS ago: both
 * files first, then the row (with its encrypted number) and a `identity_document.purged` audit row in one
 * transaction. Same guarantees as the general document purge: tenant-scoped, re-checks eligibility inside the
 * transaction, idempotent, per-row failure isolation, and logs carry ids only.
 */
export async function purgeExpiredIdentityDocuments(o: IdentityPurgeOptions): Promise<PurgeResult> {
  const now = o.now ?? new Date();
  const limit = Math.min(Math.max(o.limit ?? 100, 1), 1000);
  const result: PurgeResult = { companyId: o.companyId, dryRun: o.dryRun ?? false, scanned: 0, purged: 0, failed: 0, failedIds: [] };
  const eligible = { deletedAt: { not: null }, purgeAfterAt: { not: null, lte: now } };

  type Due = { id: string; employeeId: string; frontPath: string; backPath: string | null; deletedAt: Date };
  const due: Due[] = await o.runner({ companyId: o.companyId }, (db) =>
    db.employeeIdentityDocument.findMany({ where: eligible, orderBy: { purgeAfterAt: 'asc' }, take: limit, select: { id: true, employeeId: true, frontPath: true, backPath: true, deletedAt: true } }),
  );
  result.scanned = due.length;
  if (o.dryRun) {
    o.log.info({ companyId: o.companyId, due: due.length }, 'identity document purge dry run');
    return result;
  }

  for (const doc of due) {
    try {
      await o.storage.remove(doc.frontPath);
      if (doc.backPath) await o.storage.remove(doc.backPath);
      const deleted = await o.runner({ companyId: o.companyId }, async (db) => {
        const n = (await db.employeeIdentityDocument.deleteMany({ where: { id: doc.id, ...eligible } })) as { count: number };
        if (n.count === 1) {
          await db.auditLog.create({
            data: { actorId: null, action: 'identity_document.purged', entity: 'EmployeeIdentityDocument', entityId: doc.id, oldValue: { employeeId: doc.employeeId, deletedAt: doc.deletedAt, retentionDays: RETENTION_DAYS } },
          });
        }
        return n.count;
      });
      if (deleted === 1) result.purged += 1;
    } catch (e) {
      result.failed += 1;
      result.failedIds.push(doc.id);
      o.log.error({ companyId: o.companyId, documentId: doc.id, reason: e instanceof Error ? e.name : 'unknown' }, 'identity document purge failed; will retry on the next run');
    }
  }
  o.log.info({ companyId: o.companyId, scanned: result.scanned, purged: result.purged, failed: result.failed }, 'identity document purge finished');
  return result;
}
