import { z } from 'zod';

export const employeeDocumentCategorySchema = z.enum(['ID_PROOF', 'CONTRACT', 'OFFER_LETTER', 'CERTIFICATE', 'OTHER']);
export const companyDocumentTypeSchema = z.enum(['POLICY', 'HANDBOOK', 'FORM', 'OTHER']);

export const documentSchema = z.object({
  id: z.uuid(),
  ownerEmployeeId: z.uuid().nullable().optional(),
  category: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  visibleToManager: z.boolean().optional(),
  isCompanyDocument: z.boolean().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const uploadEmployeeDocumentSchema = z.object({
  employeeId: z.uuid().optional(),
  category: employeeDocumentCategorySchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentBase64: z.string().min(1),
  visibleToManager: z.boolean().optional(),
}).strict();
export const uploadCompanyDocumentSchema = z.object({
  category: companyDocumentTypeSchema.default('POLICY'),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentBase64: z.string().min(1),
}).strict();
export const documentListQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  company: z.coerce.boolean().optional(),
}).strict();
export const documentListResponseSchema = z.object({ data: z.array(documentSchema) });
export const documentDownloadQuerySchema = z.object({ inline: z.enum(['true', 'false']).optional() }).strict();
export const documentDownloadResponseSchema = z.object({ data: z.object({ url: z.string(), expiresInSeconds: z.number().int() }) });
export const updateDocumentVisibilitySchema = z.object({ visibleToManager: z.boolean() }).strict();

// Multipart upload (replaces the base64 JSON body) ------------------------------------------------------------
export const DOCUMENT_ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Download links are valid for exactly this long (PRD DOC-003). */
export const DOCUMENT_SIGNED_URL_TTL_SECONDS = 60;

const formBoolean = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
/** Text fields of `POST /documents/employee` (multipart/form-data); the file is the `file` part. */
export const uploadEmployeeDocumentFieldsSchema = z.object({
  employeeId: z.uuid().optional(),
  category: employeeDocumentCategorySchema,
  visibleToManager: formBoolean.optional(),
}).strict();
/** Text fields of `POST /documents/company` (multipart/form-data); the file is the `file` part. */
export const uploadCompanyDocumentFieldsSchema = z.object({
  category: companyDocumentTypeSchema.default('POLICY'),
}).strict();
export const documentUploadResponseSchema = z.object({
  data: z.object({ id: z.uuid(), fileName: z.string(), category: z.string(), mimeType: z.string(), sizeBytes: z.number().int(), createdAt: z.string() }),
});
