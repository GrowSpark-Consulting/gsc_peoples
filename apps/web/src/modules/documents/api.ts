import { documentDownloadResponseSchema, documentListResponseSchema } from '@gsc/contracts';
import { apiRequest } from '@/lib/api-client';

const enc = encodeURIComponent;

/** Allowed uploads (PRD DOC-001): PDF, PNG, JPG, DOCX, at most 10 MB. The server checks again. */
export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
};
export const MAX_BYTES = 10 * 1024 * 1024;

/** Client-side pre-check so obviously invalid files never leave the browser. Returns a message or null. */
export function validateFile(file: { type: string; size: number }): string | null {
  if (!(file.type in ALLOWED_TYPES)) return 'Choose a PDF, PNG, JPG or DOCX file.';
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > MAX_BYTES) return 'Files can be at most 10 MB.';
  return null;
}

export const listDocuments = () =>
  apiRequest('/documents', { schema: documentListResponseSchema }).then((r) => r.data);
/** Uploads are multipart/form-data (the file is streamed, not base64-encoded into JSON). */
export const uploadEmployeeDocument = (input: { file: File; category: string; employeeId?: string; visibleToManager?: boolean }) => {
  const form = new FormData();
  form.set('category', input.category);
  if (input.employeeId) form.set('employeeId', input.employeeId);
  if (input.visibleToManager !== undefined) form.set('visibleToManager', String(input.visibleToManager));
  form.set('file', input.file, input.file.name);
  return apiRequest('/documents/employee', { method: 'POST', body: form });
};
export const uploadCompanyDocument = (input: { file: File; category: string }) => {
  const form = new FormData();
  form.set('category', input.category);
  form.set('file', input.file, input.file.name);
  return apiRequest('/documents/company', { method: 'POST', body: form });
};
export const setVisibility = (id: string, visibleToManager: boolean) =>
  apiRequest(`/documents/${enc(id)}/visibility`, { method: 'PATCH', body: { visibleToManager } });
export const deleteDocument = (id: string) => apiRequest(`/documents/${enc(id)}`, { method: 'DELETE' });

/**
 * Asks the API for a download link. The API authorises the caller first, then returns a link that works for
 * `expiresInSeconds` (60) and then stops working; there is never a permanent or public file URL.
 * `inline` asks for a link that opens in the browser (preview) instead of forcing a download.
 */
export const getDocumentLink = (id: string, inline: boolean) =>
  apiRequest(`/documents/${enc(id)}/download`, { query: { inline }, schema: documentDownloadResponseSchema }).then((r) => r.data);
