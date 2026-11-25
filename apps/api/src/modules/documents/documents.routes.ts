import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  DOCUMENT_SIGNED_URL_TTL_SECONDS,
  PERMISSIONS,
  documentDownloadQuerySchema,
  documentListQuerySchema,
  updateDocumentVisibilitySchema,
  uploadCompanyDocumentFieldsSchema,
  uploadEmployeeDocumentFieldsSchema,
} from '@gsc/contracts';
import type { PrismaClient } from '../../database/generated/client';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { validate } from '../../middleware/validation/validate';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { AppError, ForbiddenError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../shared/errors';
import { LOCAL_FILE_ROUTE, StorageError, type DocumentStorage, type LocalDocumentStorage } from '../../integrations/storage';
import { checkUpload, cleanFileName } from './documents.rules';
import { resolveTeamEmployeeIds } from '../authorization/team-scope';
import { readUpload } from './multipart';

/** Documents stay recoverable for this long after a soft delete; the retention job purges after it. */
import { RETENTION_DAYS } from './retention';
const uuidParam = z.object({ id: z.string().uuid() });

/**
 * Storage failures are logged by the global handler only when unexpected; the caller always gets a generic
 * 503 so a bucket name, key or provider message never reaches the browser.
 */
function storageUnavailable(e: unknown): never {
  if (e instanceof StorageError && e.status === 404) throw new NotFoundError('The stored file is missing');
  throw new ServiceUnavailableError('Document storage is temporarily unavailable');
}

export function createDocumentsRouter(_prisma: PrismaClient, tenantRunner: TenantRunner, storage: DocumentStorage): Router {
  const router = Router();
  const run = tenantRunner;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- express request augmented by the auth middleware
  const ctx = (req: any) => ({ companyId: req.user.companyId as string });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const has = (req: any, p: string) => (req.user.permissions as string[]).includes(p);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function canReadEmployeeDoc(db: TenantDb, req: any, doc: any) {
    if (doc.isCompanyDocument) return has(req, PERMISSIONS.DOCUMENT_READ_ALL) || has(req, PERMISSIONS.DOCUMENT_READ_SELF) || has(req, PERMISSIONS.COMPANY_READ);
    if (has(req, PERMISSIONS.DOCUMENT_READ_ALL)) return true;
    if (doc.ownerEmployeeId && doc.ownerEmployeeId === req.user.employeeId) return true;
    // DOC-004 with PRD section 5 team scope: direct and indirect reports, only when flagged.
    if (doc.visibleToManager && has(req, PERMISSIONS.DOCUMENT_READ_TEAM)) {
      return (await resolveTeamEmployeeIds(db, req.user.employeeId ?? null)).includes(doc.ownerEmployeeId);
    }
    return false;
  }

  router.get('/', requireAnyPermission(PERMISSIONS.DOCUMENT_READ_ALL, PERMISSIONS.DOCUMENT_READ_SELF, PERMISSIONS.DOCUMENT_READ_TEAM), validate({ query: documentListQuerySchema }), async (req, res) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = req.query as any;
    const data = await run(ctx(req), async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { deletedAt: null };
      if (q.company) where.isCompanyDocument = true;
      else if (q.employeeId) where.ownerEmployeeId = q.employeeId;
      else if (!has(req, PERMISSIONS.DOCUMENT_READ_ALL)) {
        const teamIds = has(req, PERMISSIONS.DOCUMENT_READ_TEAM)
          ? await resolveTeamEmployeeIds(db, req.user!.employeeId ?? null)
          : [];
        where.OR = [
          { ownerEmployeeId: req.user!.employeeId },
          { isCompanyDocument: true },
          ...(teamIds.length ? [{ ownerEmployeeId: { in: teamIds }, visibleToManager: true }] : []),
        ];
      }
      const rows = await db.employeeDocument.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered: any[] = [];
      for (const row of rows) if (await canReadEmployeeDoc(db, req, row)) filtered.push(row);
      // `storedPath` (the storage key) is deliberately not part of the response.
      return filtered.map((d) => ({ id: d.id, ownerEmployeeId: d.ownerEmployeeId, category: d.category, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, visibleToManager: d.visibleToManager, isCompanyDocument: d.isCompanyDocument, createdAt: d.createdAt, updatedAt: d.updatedAt }));
    });
    res.json({ data });
  });

  /**
   * Shared upload pipeline. Order matters: authorise and resolve the owner first (own transaction, no network
   * I/O inside it), then validate the bytes, then write to storage, then insert the row and the audit entry in
   * one transaction. If the insert fails the object is removed again, so a failed upload leaves nothing behind.
   */
  async function handleUpload(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req: any,
    kind: 'employee' | 'company',
  ) {
    const upload = await readUpload(req);
    const fields =
      kind === 'employee'
        ? uploadEmployeeDocumentFieldsSchema.safeParse(upload.fields)
        : uploadCompanyDocumentFieldsSchema.safeParse(upload.fields);
    if (!fields.success) throw new ValidationError('Request validation failed', fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (!upload.file) throw new ValidationError('Attach a file in the "file" part');
    const f = fields.data as { employeeId?: string; category: string; visibleToManager?: boolean };

    const ownerEmployeeId: string | null = await run(ctx(req), async (db) => {
      if (kind === 'company') return null;
      const owner = f.employeeId ?? req.user.employeeId;
      if (!owner) throw new NotFoundError('Employee profile not found');
      // Own record needs upload:self (checked by the route gate); another employee's record needs upload:all.
      if (owner !== req.user.employeeId && !has(req, PERMISSIONS.DOCUMENT_UPLOAD_ALL)) throw new ForbiddenError();
      const exists = await db.employee.findFirst({ where: { id: owner }, select: { id: true } });
      if (!exists) throw new NotFoundError('Employee not found');
      return owner as string;
    });

    const verdict = checkUpload(upload.file);
    if (!verdict.ok) throw verdict.status === 413 ? new AppError(413, 'PAYLOAD_TOO_LARGE', verdict.message) : new ValidationError(verdict.message);

    const key = `${req.user.companyId}/${ownerEmployeeId ?? 'company'}/${crypto.randomUUID()}`;
    const fileName = cleanFileName(upload.file.fileName);
    try {
      await storage.put({ key, body: upload.file.buffer, contentType: upload.file.mimeType });
    } catch (e) {
      storageUnavailable(e);
    }
    try {
      return await run(ctx(req), async (db) => {
        const row = await db.employeeDocument.create({
          data: {
            ownerEmployeeId,
            isCompanyDocument: kind === 'company',
            category: f.category,
            fileName,
            storedPath: key,
            mimeType: upload.file!.mimeType,
            sizeBytes: upload.file!.buffer.length,
            // DOC-004: only HR decides that a manager may see a document; an uploader without that permission cannot.
            visibleToManager: kind === 'employee' && has(req, PERMISSIONS.DOCUMENT_VISIBILITY_MANAGE) ? (f.visibleToManager ?? false) : false,
            uploadedByUserId: req.user.userId,
          },
        });
        await db.auditLog.create({ data: { actorId: req.user.userId, action: 'document.uploaded', entity: 'EmployeeDocument', entityId: row.id, newValue: { ownerEmployeeId, fileName, category: f.category, sizeBytes: row.sizeBytes, isCompanyDocument: kind === 'company' } } });
        return row;
      });
    } catch (e) {
      await storage.remove(key).catch(() => undefined); // best effort: nothing may stay behind without a row
      throw e;
    }
  }

  const uploadResponse = (d: { id: string; fileName: string; category: string; mimeType: string; sizeBytes: number; createdAt: Date }) => ({
    id: d.id,
    fileName: d.fileName,
    category: d.category,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt,
  });

  router.post('/employee', requirePermission(PERMISSIONS.DOCUMENT_UPLOAD), async (req, res) => {
    res.status(201).json({ data: uploadResponse(await handleUpload(req, 'employee')) });
  });

  router.post('/company', requirePermission(PERMISSIONS.DOCUMENT_COMPANY_MANAGE), async (req, res) => {
    res.status(201).json({ data: uploadResponse(await handleUpload(req, 'company')) });
  });

  /**
   * DOC-003: authorisation happens here, on every request; the response is a link that stops working after
   * 60 seconds. Soft-deleted documents are not downloadable (404). The storage key is never returned.
   */
  router.get('/:id/download', requireAnyPermission(PERMISSIONS.DOCUMENT_READ_ALL, PERMISSIONS.DOCUMENT_READ_SELF, PERMISSIONS.DOCUMENT_READ_TEAM), validate({ params: uuidParam, query: documentDownloadQuerySchema }), async (req, res) => {
    const id = (req.params as { id: string }).id;
    const inline = (req.query as { inline?: string }).inline === 'true';
    const doc = await run(ctx(req), async (db) => {
      const d = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
      if (!d) throw new NotFoundError('Document not found');
      if (!(await canReadEmployeeDoc(db, req, d))) throw new ForbiddenError();
      return d;
    });
    let url: string;
    try {
      url = await storage.createSignedDownloadUrl(doc.storedPath, {
        expiresInSeconds: DOCUMENT_SIGNED_URL_TTL_SECONDS,
        fileName: doc.fileName,
        contentType: doc.mimeType,
        inline,
        requestOrigin: `${req.protocol}://${req.get('host')}`,
      });
    } catch (e) {
      storageUnavailable(e);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { url, expiresInSeconds: DOCUMENT_SIGNED_URL_TTL_SECONDS } });
  });

  router.patch('/:id/visibility', requirePermission(PERMISSIONS.DOCUMENT_VISIBILITY_MANAGE), validate({ params: uuidParam, body: updateDocumentVisibilitySchema }), async (req, res) => {
    const id = (req.params as { id: string }).id;
    const data = await run(ctx(req), async (db) => {
      const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null, isCompanyDocument: false } });
      if (!doc) throw new NotFoundError('Document not found');
      const updated = await db.employeeDocument.update({ where: { id }, data: { visibleToManager: req.body.visibleToManager } });
      await db.auditLog.create({ data: { actorId: req.user!.userId, action: 'document.visibility_changed', entity: 'EmployeeDocument', entityId: id, oldValue: { visibleToManager: doc.visibleToManager }, newValue: { visibleToManager: updated.visibleToManager } } });
      return { id: updated.id, visibleToManager: updated.visibleToManager, updatedAt: updated.updatedAt };
    });
    res.json({ data });
  });

  /**
   * Soft delete: the row gets `deletedAt` and a purge date 30 days out and disappears from every list and
   * download immediately. The object stays in the bucket until the retention purge removes it (retention.ts,
   * run by `jobs/purge-documents.ts`), so an accidental delete is recoverable. Deleting twice is a 404.
   */
  router.delete('/:id', requirePermission(PERMISSIONS.DOCUMENT_DELETE), validate({ params: uuidParam }), async (req, res) => {
    const id = (req.params as { id: string }).id;
    await run(ctx(req), async (db) => {
      const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
      if (!doc) throw new NotFoundError('Document not found');
      const now = new Date();
      await db.employeeDocument.update({ where: { id }, data: { deletedAt: now, purgeAfterAt: new Date(now.getTime() + RETENTION_DAYS * 86_400_000) } });
      await db.auditLog.create({ data: { actorId: req.user!.userId, action: 'document.deleted', entity: 'EmployeeDocument', entityId: id, oldValue: { fileName: doc.fileName, ownerEmployeeId: doc.ownerEmployeeId, isCompanyDocument: doc.isCompanyDocument } } });
    });
    res.status(204).send();
  });

  return router;
}

/**
 * Local driver only (development and tests): serves a file for a signed link. The HMAC token IS the
 * authorisation, so this is mounted outside the session middleware, exactly like a Supabase signed URL.
 */
export function createLocalFileRouter(storage: LocalDocumentStorage): Router {
  const router = Router();
  router.get(`${LOCAL_FILE_ROUTE}/:token`, async (req, res) => {
    try {
      const file = await storage.readSigned(String(req.params.token));
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `${file.inline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/[^\x20-\x7e]|"/g, '_')}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(file.body);
    } catch (e) {
      const status = e instanceof StorageError && e.status ? e.status : 404;
      res.status(status === 403 ? 403 : 404).json({ error: { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', message: status === 403 ? 'This link is invalid or has expired' : 'File not found' } });
    }
  });
  return router;
}
