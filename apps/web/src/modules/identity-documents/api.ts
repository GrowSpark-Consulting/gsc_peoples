import {
  apiErrorSchema,
  identityDocumentLinkResponseSchema,
  identityDocumentResponseSchema,
  identityDocumentRevealResponseSchema,
  type IdentityDocument,
  type IdentityDocumentSide,
  type IdentityDocumentType,
} from '@gsc/contracts';
import { publicEnv } from '@/config/env';
import { apiRequest } from '@/lib/api-client';
import { ApiError } from '@/modules/employees/errors';
import { readCsrfToken } from '@/modules/employees/adapters/http-service';

/**
 * Government ID API client. Same security model as `apiRequest` (httpOnly session cookie, double-submit CSRF
 * token on writes). Nothing here logs: never pass document numbers or links to the console or analytics.
 */
const enc = encodeURIComponent;
const base = (employeeId: string) => `/employees/${enc(employeeId)}/identity-document`;

export const getIdentityDocument = (employeeId: string): Promise<IdentityDocument | null> =>
  apiRequest(base(employeeId), { schema: identityDocumentResponseSchema }).then((r) => r.data);

/** A link that works for 60 seconds. Issued (and audited) by the API only after it authorises the caller. */
export const getIdentityDocumentLink = (employeeId: string, side: IdentityDocumentSide, inline: boolean) =>
  apiRequest(`${base(employeeId)}/${side}/link`, { query: { inline }, schema: identityDocumentLinkResponseSchema }).then((r) => r.data);

/** Super Admin only (enforced by the API). Audited. Keep the result in component state only, never persist it. */
export const revealIdentityNumber = (employeeId: string) =>
  apiRequest(`${base(employeeId)}/reveal`, { method: 'POST', schema: identityDocumentRevealResponseSchema }).then((r) => r.data.documentNumber);

export const deleteIdentityDocument = (employeeId: string) => apiRequest(`${base(employeeId)}`, { method: 'DELETE' });

export interface IdentityUploadInput {
  documentType: IdentityDocumentType;
  documentNumber: string;
  front: File;
  back: File | null;
}

/**
 * Multipart PUT with upload progress (fetch cannot report upload progress, XMLHttpRequest can).
 * Resolves with the masked document; rejects with an ApiError carrying the server's field errors.
 */
export function uploadIdentityDocument(employeeId: string, input: IdentityUploadInput, onProgress?: (fraction: number) => void, baseUrl = publicEnv.apiUrl): Promise<IdentityDocument> {
  const form = new FormData();
  form.set('documentType', input.documentType);
  form.set('documentNumber', input.documentNumber);
  form.set('consent', 'true');
  form.set('front', input.front, input.front.name);
  if (input.back) form.set('back', input.back, input.back.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${baseUrl.replace(/\/+$/, '')}${base(employeeId)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-CSRF-Token', readCsrfToken());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'The upload was cancelled'));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status === 401 && typeof window !== 'undefined') window.location.replace('/login');
      if (xhr.status < 200 || xhr.status >= 300) {
        const parsed = apiErrorSchema.safeParse(body);
        if (parsed.success) {
          const { code, message, details, requestId } = parsed.data.error;
          return reject(new ApiError(xhr.status, code, message, details, requestId));
        }
        return reject(new ApiError(xhr.status, 'HTTP_ERROR', `Request failed (${xhr.status})`));
      }
      const parsed = identityDocumentResponseSchema.safeParse(body);
      if (!parsed.success || !parsed.data.data) return reject(new ApiError(xhr.status, 'BAD_RESPONSE', 'The server sent an unexpected response'));
      onProgress?.(1);
      resolve(parsed.data.data);
    };
    xhr.send(form);
  });
}

/** Field -> message from an identity upload error (`details: [{ path: 'front', message }]`). */
export function identityFieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return out;
  for (const d of e.details as { path?: unknown; message?: unknown }[]) {
    const path = Array.isArray(d.path) ? d.path[0] : d.path;
    if (typeof path === 'string' && typeof d.message === 'string' && !(path in out)) out[path] = d.message;
  }
  return out;
}

/** Opens a short-lived link: preview in a new tab (opened inside the click so it is not blocked) or download. */
export async function openIdentityFile(employeeId: string, side: IdentityDocumentSide, mode: 'preview' | 'download') {
  const tab = mode === 'preview' ? window.open('about:blank', '_blank') : null;
  try {
    const link = await getIdentityDocumentLink(employeeId, side, mode === 'preview');
    if (mode === 'preview') {
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.open(link.url, '_blank', 'noopener');
      }
    } else {
      const a = document.createElement('a');
      a.href = link.url;
      a.rel = 'noopener';
      a.click();
    }
  } catch (e) {
    tab?.close();
    throw e;
  }
}
