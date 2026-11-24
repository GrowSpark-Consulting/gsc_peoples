import type { TenantRunner } from '../../database/tenant';
import type { DocumentStorage } from '../../integrations/storage';

/** Documents are recoverable for this many days after a soft delete (PRD DOC-005). Written by DELETE /documents/:id. */
export const RETENTION_DAYS = 30;

export interface PurgeLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface PurgeOptions {
  companyId: string;
  runner: TenantRunner;
  storage: DocumentStorage;
  now?: Date;
  /** Upper bound of documents handled per call; the rest is picked up by the next run. */
  limit?: number;
  /** Report what would be purged without touching storage or the database. */
  dryRun?: boolean;
  log: PurgeLogger;
}

export interface PurgeResult {
  companyId: string;
  dryRun: boolean;
  scanned: number;
  purged: number;
  failed: number;
  /** Ids only: never keys, names or provider messages. */
  failedIds: string[];
}

/**
 * Permanently removes soft-deleted documents whose retention period has ended, for ONE company.
 *
 * Safety properties (each covered by a test):
 *  - tenant-safe: every query runs in the tenant runner for `companyId`; another company's rows are invisible;
 *  - never touches an active document: a row is eligible only while `deletedAt` is set AND `purgeAfterAt <= now`,
 *    and that condition is re-checked inside the transaction that deletes the row (a restore in between wins);
 *  - idempotent: removing an object that is already gone is success, a second run finds nothing to do;
 *  - order: object first, then row. A crash or failure in between leaves the row, which the next run retries;
 *    the reverse order could orphan an object forever;
 *  - failures are isolated per document, logged without keys or file names, and never abort the batch;
 *  - the audit row (`document.purged`, actor null = system) is written in the same transaction as the row delete.
 */
export async function purgeExpiredDocuments(o: PurgeOptions): Promise<PurgeResult> {
  const now = o.now ?? new Date();
  const limit = Math.min(Math.max(o.limit ?? 100, 1), 1000);
  const result: PurgeResult = { companyId: o.companyId, dryRun: o.dryRun ?? false, scanned: 0, purged: 0, failed: 0, failedIds: [] };
  const eligible = { deletedAt: { not: null }, purgeAfterAt: { not: null, lte: now } };

  type Due = { id: string; storedPath: string; ownerEmployeeId: string | null; isCompanyDocument: boolean; deletedAt: Date };
  const due: Due[] = await o.runner({ companyId: o.companyId }, (db) =>
    db.employeeDocument.findMany({ where: eligible, orderBy: { purgeAfterAt: 'asc' }, take: limit, select: { id: true, storedPath: true, ownerEmployeeId: true, isCompanyDocument: true, deletedAt: true } }),
  );
  result.scanned = due.length;
  if (o.dryRun) {
    o.log.info({ companyId: o.companyId, due: due.length }, 'document purge dry run');
    return result;
  }

  for (const doc of due) {
    try {
      await o.storage.remove(doc.storedPath); // already-missing object is not an error
      const deleted = await o.runner({ companyId: o.companyId }, async (db) => {
        // Re-check inside the transaction: a document restored meanwhile is no longer eligible.
        const n = (await db.employeeDocument.deleteMany({ where: { id: doc.id, ...eligible } })) as { count: number };
        if (n.count === 1) {
          await db.auditLog.create({
            data: { actorId: null, action: 'document.purged', entity: 'EmployeeDocument', entityId: doc.id, oldValue: { ownerEmployeeId: doc.ownerEmployeeId, isCompanyDocument: doc.isCompanyDocument, deletedAt: doc.deletedAt, retentionDays: RETENTION_DAYS } },
          });
        }
        return n.count;
      });
      if (deleted === 1) result.purged += 1;
    } catch (e) {
      result.failed += 1;
      result.failedIds.push(doc.id);
      o.log.error({ companyId: o.companyId, documentId: doc.id, reason: e instanceof Error ? e.name : 'unknown' }, 'document purge failed; will retry on the next run');
    }
  }
  o.log.info({ companyId: o.companyId, scanned: result.scanned, purged: result.purged, failed: result.failed }, 'document purge finished');
  return result;
}

/** Runs the purge for several companies; one company failing never stops the others. */
export async function purgeAllCompanies(companyIds: readonly string[], base: Omit<PurgeOptions, 'companyId'>): Promise<PurgeResult[]> {
  const out: PurgeResult[] = [];
  for (const companyId of companyIds) {
    try {
      out.push(await purgeExpiredDocuments({ ...base, companyId }));
    } catch (e) {
      base.log.error({ companyId, reason: e instanceof Error ? e.name : 'unknown' }, 'document purge could not run for this company');
      out.push({ companyId, dryRun: base.dryRun ?? false, scanned: 0, purged: 0, failed: 1, failedIds: [] });
    }
  }
  return out;
}
