/**
 * Shared client for the HR API (`/api/v1`). Same security model as the employees adapter: the httpOnly
 * `gsc_session` cookie authenticates (sent with `credentials: 'include'`), writes carry the double-submit
 * CSRF token from the readable `gsc_csrf` cookie, and the browser never supplies identity, role or company.
 * Responses are parsed with the shared Zod contracts; nothing is defaulted or fabricated on failure.
 */
import { apiErrorSchema } from '@gsc/contracts';
import type { ZodType } from 'zod';
import { publicEnv } from '@/config/env';
import { ApiError } from '@/modules/employees/errors';
import { readCsrfToken } from '@/modules/employees/adapters/http-service';

export type QueryValue = string | number | boolean | undefined | null | readonly string[];

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Response contract. Omit only for 204 responses. */
  schema?: ZodType<T>;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Called for every 401 so an expired or revoked session sends the user to sign in. */
function onUnauthorized() {
  if (typeof window !== 'undefined') window.location.replace('/login');
}

export async function apiRequest<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const root = (opts.baseUrl ?? publicEnv.apiUrl).replace(/\/+$/, '');
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${root}${path}${buildQuery(opts.query)}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        // FormData sets its own multipart Content-Type (with the boundary); never override it.
        ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': readCsrfToken() } : {}),
      },
      body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }
  if (res.status === 401) onUnauthorized();
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      throw new ApiError(res.status, code, message, details, requestId);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }
  if (!opts.schema) return body as T;
  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unexpected response');
  }
  return parsed.data;
}

/** Human message for any failure (403, 404, 409, 422/validation, 5xx, network), safe to show. */
export function describeApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Could not reach the server. Check your connection and try again.';
    if (e.status === 403) return 'You do not have permission to do that.';
    if (e.status === 404) return 'This item could not be found, or you do not have access to it.';
    if (e.status === 413) return 'The file is too large for the server to accept.';
    if (e.status >= 500) return 'Something went wrong on our side. Please try again.';
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;
