import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  DOCUMENT_SIGNED_URL_TTL_SECONDS,
  IDENTITY_DOCUMENT_ALLOWED_MIME_TYPES,
  IDENTITY_DOCUMENT_MAX_BYTES,
  PERMISSIONS,
  checkIdentityFileMeta,
  identityBackRequired,
  identityDocumentFieldsSchema,
  identityDocumentLinkQuerySchema,
  identityDocumentSideSchema,
  maskIdentityNumber,
  validateIdentityNumber,
  type IdentityDocument,
  type IdentityDocumentSide,
  type IdentityDocumentType,
} from '@gsc/contracts';
import type { TenantDb, TenantRunner } from '../../database/tenant';
import { validate } from '../../middleware/validation/validate';
import { requirePermission } from '../../middleware/authorization/authorize';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '../../shared/errors';
import { StorageError, type DocumentStorage } from '../../integrations/storage';
import { logger } from '../../shared/utils/logger';
import { matchesSignature } from '../documents/documents.rules';
import { readMultiUpload } from '../documents/multipart';
import { RETENTION_DAYS } from '../documents/retention';
import { identityAad, type IdentityCipher } from './identity-crypto';

/**
 * Government ID / identity proof, mounted at `/employees/:employeeId/identity-document`.
 *
 * Authorisation (enforced here, never only in the UI):
 *  - read masked metadata and images: `identity-document:read:all` (Super Admin, HR) or `:read:self` for the
 *    caller's own employee record; a Manager has no access to anyone else's document;
 *  - submit/replace: `identity-document:write:all` or `:write:self` for the own record;
 *  - delete: `identity-document:delete`;
 *  - full number: `identity-document:reveal` (Super Admin only), audited. No other response ever carries it.
 * The permission check runs BEFORE any database read, so a caller without rights cannot probe whether an
 * employee exists. Tenant isolation comes from the tenant runner (Postgres RLS): another company's employee is 404.
 *
 * Never logged or returned: document numbers (full or last four), file bytes, storage keys, signed links.
 */

const ENTITY = 'EmployeeIdentityDocument';
const params = z.object({ employeeId: z.string().uuid() });
const sideParams = params.extend({ side: identityDocumentSideSchema });
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

type User = NonNullable<Request['user']>;
type Row = {
  id: string;
  employeeId: string;
  documentType: IdentityDocumentType;
  numberCiphertext: string;
  numberLast4: string;
  frontPath: string;
  frontMimeType: string;
  frontSizeBytes: number;
  backPath: string | null;
  backMimeType: string | null;
  backSizeBytes: number | null;
  consentRecordedAt: Date;
  firstUploadedAt: Date;
  createdAt: Date;
};

export function toIdentityDocumentDto(r: Row): IdentityDocument {
  return {
    id: r.id,
    employeeId: r.employeeId,
    documentType: r.documentType,
    maskedNumber: maskIdentityNumber(r.documentType, r.numberLast4),
    front: { mimeType: r.frontMimeType, sizeBytes: r.frontSizeBytes },
    back: r.backPath && r.backMimeType && r.backSizeBytes ? { mimeType: r.backMimeType, sizeBytes: r.backSizeBytes } : null,
    uploadedAt: r.firstUploadedAt.toISOString(),
    updatedAt: r.createdAt.toISOString(),
    consentRecordedAt: r.consentRecordedAt.toISOString(),
  };
}

export interface IdentityDocumentsDeps {
  runner: TenantRunner;
  storage: DocumentStorage;
  /** Null when IDENTITY_DOC_ENCRYPTION_KEY is not configured: every endpoint then answers 503. */
  cipher: IdentityCipher | null;
}

const isUniqueViolation = (e: unknown) => (e as { code?: unknown } | null)?.code === 'P2002';

export function createIdentityDocumentsRouter({ runner, storage, cipher }: IdentityDocumentsDeps): Router {
  const router = Router({ mergeParams: true });

  const user = (req: Request): User => {
    if (!req.user) throw new UnauthorizedError();
    return req.user;
  };
  const has = (u: User, p: string) => u.permissions.includes(p);
  const employeeIdOf = (req: Request) => (req.params as { employeeId: string }).employeeId;
  const requireCipher = (): IdentityCipher => {
    if (!cipher) throw new ServiceUnavailableError('Identity documents are not available: encryption is not configured');
    return cipher;
  };
  /** Scope check before any database access. */
  const authorise = (u: User, employeeId: string, all: string, self: string) => {
    if (has(u, all)) return;
    if (has(u, self) && u.employeeId && u.employeeId === employeeId) return;
    throw new ForbiddenError();
  };
  const audit = (db: TenantDb, u: User, action: string, entityId: string, value: Record<string, unknown>) =>
    db.auditLog.create({ data: { actorId: u.userId, action, entity: ENTITY, entityId, newValue: value } });
  const activeRow = (db: TenantDb, employeeId: string) => db.employeeIdentityDocument.findFirst({ where: { employeeId, deletedAt: null } }) as Promise<Row | null>;
  const requireEmployee = async (db: TenantDb, employeeId: string) => {
    if (!(await db.employee.findFirst({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundError('Employee not found');
  };
  const storageFailed = (e: unknown): never => {
    if (e instanceof StorageError && e.status === 404) throw new NotFoundError('The stored file is missing');
    throw new ServiceUnavailableError('Document storage is temporarily unavailable');
  };

  /** Masked metadata (or `null` when none). Audited: viewing even the masked record is an access. */
  router.get('/', validate({ params }), async (req, res) => {
    const u = user(req);
    const employeeId = employeeIdOf(req);
    authorise(u, employeeId, PERMISSIONS.IDENTITY_DOCUMENT_READ_ALL, PERMISSIONS.IDENTITY_DOCUMENT_READ_SELF);
    requireCipher();
    const data = await runner({ companyId: u.companyId }, async (db) => {
      await requireEmployee(db, employeeId);
      const row = await activeRow(db, employeeId);
      if (!row) return null;
      await audit(db, u, 'identity_document.metadata_viewed', row.id, { employeeId });
      return toIdentityDocumentDto(row);
    });
    res.json({ data });
  });

  /**
   * Submit or replace (multipart: documentType, documentNumber, consent, front, back?).
   * Order: authorise -> parse and validate everything (number format, both files' type, extension, size and
   * content signature) -> confirm the employee in this tenant -> store files -> ONE transaction that retires the
   * current row, inserts the new one and audits. If anything after the first `put` fails, every new object is
   * removed again, so a failure never leaves orphaned files. Concurrent submissions: the partial unique index
   * lets exactly one win; the other gets 409 and its files are removed.
   */
  router.put('/', validate({ params }), async (req, res) => {
    const u = user(req);
    const employeeId = employeeIdOf(req);
    authorise(u, employeeId, PERMISSIONS.IDENTITY_DOCUMENT_WRITE_ALL, PERMISSIONS.IDENTITY_DOCUMENT_WRITE_SELF);
    const c = requireCipher();

    const upload = await readMultiUpload(req, { fileFields: ['front', 'back'], maxBytes: IDENTITY_DOCUMENT_MAX_BYTES, maxFields: 3, sizeLabel: '5 MB' });
    const parsed = identityDocumentFieldsSchema.safeParse(upload.fields);
    // Issue messages only (zod messages here never contain the submitted value).
    if (!parsed.success) throw new ValidationError('Request validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const { documentType } = parsed.data;
    const number = validateIdentityNumber(documentType, parsed.data.documentNumber);
    if (!number.ok) throw new ValidationError(number.message, [{ path: 'documentNumber', message: number.message }]);

    const issues: { path: string; message: string }[] = [];
    const checkFile = (side: IdentityDocumentSide) => {
      const f = upload.files[side];
      if (!f) return;
      if (f.truncated || f.buffer.length > IDENTITY_DOCUMENT_MAX_BYTES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Each file can be at most 5 MB');
      const meta = checkIdentityFileMeta({ name: f.fileName, type: f.mimeType, size: f.buffer.length });
      if (meta) return issues.push({ path: side, message: meta });
      if (!(IDENTITY_DOCUMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(f.mimeType) || !matchesSignature(f.mimeType, f.buffer)) {
        issues.push({ path: side, message: 'The file content does not match its type.' });
      }
    };
    if (!upload.files.front) issues.push({ path: 'front', message: 'Upload the front side of the document.' });
    if (identityBackRequired(documentType) && !upload.files.back) issues.push({ path: 'back', message: 'Upload the back side of the document.' });
    checkFile('front');
    checkFile('back');
    if (issues.length) throw new ValidationError(issues[0]!.message, issues);

    const existing = await runner({ companyId: u.companyId }, async (db) => {
      await requireEmployee(db, employeeId);
      return activeRow(db, employeeId);
    });

    const ciphertext = c.encrypt(number.normalized, identityAad(u.companyId, employeeId, documentType));
    const front = upload.files.front!;
    const back = upload.files.back ?? null;
    const keyFor = () => `${u.companyId}/${employeeId}/${crypto.randomUUID()}`;
    const frontPath = keyFor();
    const backPath = back ? keyFor() : null;
    const stored: string[] = [];
    const cleanup = async () => {
      for (const k of stored) await storage.remove(k).catch(() => logger.warn({ event: 'identity_document.cleanup_failed', employeeId }, 'could not remove an unused identity file'));
    };

    try {
      await storage.put({ key: frontPath, body: front.buffer, contentType: front.mimeType });
      stored.push(frontPath);
      if (back && backPath) {
        await storage.put({ key: backPath, body: back.buffer, contentType: back.mimeType });
        stored.push(backPath);
      }
    } catch (e) {
      await cleanup();
      storageFailed(e);
    }

    let row: Row;
    try {
      row = await runner({ companyId: u.companyId }, async (db) => {
        const now = new Date();
        const current = await activeRow(db, employeeId);
        // The row we saw before storing changed meanwhile: someone else replaced it. Refuse rather than overwrite.
        if ((current?.id ?? null) !== (existing?.id ?? null)) throw new ConflictError('The identity document was changed by someone else. Reload and try again.');
        if (current) {
          await db.employeeIdentityDocument.update({ where: { id: current.id }, data: { deletedAt: now, purgeAfterAt: new Date(now.getTime() + RETENTION_DAYS * 86_400_000) } });
        }
        const created = (await db.employeeIdentityDocument.create({
          data: {
            employeeId,
            documentType,
            numberCiphertext: ciphertext,
            numberLast4: number.last4,
            frontPath,
            frontMimeType: front.mimeType,
            frontSizeBytes: front.buffer.length,
            backPath,
            backMimeType: back?.mimeType ?? null,
            backSizeBytes: back?.buffer.length ?? null,
            consentRecordedAt: now,
            consentRecordedByUserId: u.userId,
            uploadedByUserId: u.userId,
            firstUploadedAt: current?.firstUploadedAt ?? now,
          },
        })) as Row;
        await audit(db, u, current ? 'identity_document.replaced' : 'identity_document.uploaded', created.id, {
          employeeId,
          documentType,
          hasBack: !!back,
          previousDocumentId: current?.id ?? null,
          selfService: u.employeeId === employeeId,
        });
        return created;
      });
    } catch (e) {
      await cleanup();
      if (isUniqueViolation(e)) throw new ConflictError('The identity document was changed by someone else. Reload and try again.');
      throw e;
    }
    res.status(existing ? 200 : 201).json({ data: toIdentityDocumentDto(row) });
  });

  /**
   * A 60-second signed link to the front or back image, issued only after authorisation. The view is audited
   * before the link is returned: if the audit row cannot be written, no link is handed out.
   */
  router.get('/:side/link', validate({ params: sideParams, query: identityDocumentLinkQuerySchema }), async (req, res) => {
    const u = user(req);
    const employeeId = employeeIdOf(req);
    const side = (req.params as { side: IdentityDocumentSide }).side;
    const inline = (req.query as { inline?: string }).inline === 'true';
    authorise(u, employeeId, PERMISSIONS.IDENTITY_DOCUMENT_READ_ALL, PERMISSIONS.IDENTITY_DOCUMENT_READ_SELF);
    requireCipher();
    const row = await runner({ companyId: u.companyId }, async (db) => {
      await requireEmployee(db, employeeId);
      const r = await activeRow(db, employeeId);
      if (!r) throw new NotFoundError('No identity document on file');
      return r;
    });
    const key = side === 'front' ? row.frontPath : row.backPath;
    const mime = side === 'front' ? row.frontMimeType : row.backMimeType;
    if (!key || !mime) throw new NotFoundError('This document has no back side on file');
    let url = '';
    try {
      url = await storage.createSignedDownloadUrl(key, {
        expiresInSeconds: DOCUMENT_SIGNED_URL_TTL_SECONDS,
        // A neutral name: never the uploaded file name, which could contain the number.
        fileName: `${row.documentType.toLowerCase().replace('_', '-')}-${side}.${EXT[mime] ?? 'bin'}`,
        contentType: mime,
        inline,
        requestOrigin: `${req.protocol}://${req.get('host')}`,
      });
    } catch (e) {
      storageFailed(e);
    }
    await runner({ companyId: u.companyId }, (db) => audit(db, u, 'identity_document.viewed', row.id, { employeeId, side, inline }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { url, expiresInSeconds: DOCUMENT_SIGNED_URL_TTL_SECONDS } });
  });

  /**
   * Full number, Super Admin only (`identity-document:reveal`). The audit row is written in the same
   * transaction that decrypts: no audit, no number.
   */
  router.post('/reveal', requirePermission(PERMISSIONS.IDENTITY_DOCUMENT_REVEAL), validate({ params }), async (req, res) => {
    const u = user(req);
    const employeeId = employeeIdOf(req);
    const c = requireCipher();
    const documentNumber = await runner({ companyId: u.companyId }, async (db) => {
      await requireEmployee(db, employeeId);
      const r = await activeRow(db, employeeId);
      if (!r) throw new NotFoundError('No identity document on file');
      await audit(db, u, 'identity_document.number_revealed', r.id, { employeeId, documentType: r.documentType });
      try {
        return c.decrypt(r.numberCiphertext, identityAad(u.companyId, employeeId, r.documentType));
      } catch {
        logger.error({ event: 'identity_document.decrypt_failed', documentId: r.id }, 'identity number could not be decrypted');
        throw new AppError(500, 'DECRYPTION_FAILED', 'The document number could not be read');
      }
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { documentNumber } });
  });

  /** Soft delete; the files and encrypted number are purged after the retention period. */
  router.delete('/', requirePermission(PERMISSIONS.IDENTITY_DOCUMENT_DELETE), validate({ params }), async (req, res) => {
    const u = user(req);
    const employeeId = employeeIdOf(req);
    await runner({ companyId: u.companyId }, async (db) => {
      await requireEmployee(db, employeeId);
      const r = await activeRow(db, employeeId);
      if (!r) throw new NotFoundError('No identity document on file');
      const now = new Date();
      await db.employeeIdentityDocument.update({ where: { id: r.id }, data: { deletedAt: now, purgeAfterAt: new Date(now.getTime() + RETENTION_DAYS * 86_400_000) } });
      await audit(db, u, 'identity_document.deleted', r.id, { employeeId, documentType: r.documentType, retentionDays: RETENTION_DAYS });
    });
    res.status(204).send();
  });

  return router;
}
