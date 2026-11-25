/**
 * REAL adapter for the Employees API (`/api/v1/employees`, `/api/v1/departments`).
 * Authenticates with the httpOnly `gsc_session` cookie (sent via `credentials: 'include'`); writes
 * also carry the double-submit CSRF token from the readable `gsc_csrf` cookie. No bearer token and no
 * identity is ever supplied by the browser: the API derives user, company and permissions from the
 * session. See docs/development/employee-directory.md.
 */
import {
  apiErrorSchema,
  departmentListResponseSchema,
  employeeListResponseSchema,
  employeeResponseSchema,
  type EmployeeListQueryInput,
} from '@gsc/contracts';
import { ApiError } from '../errors';
import type { EmployeesService } from '../service';

export interface HttpServiceOptions {
  /** e.g. http://localhost:4000/api/v1 */
  baseUrl: string;
  /** Overridable for tests; defaults to reading the `gsc_csrf` cookie. */
  getCsrfToken?: () => string;
  /** Called on any 401 (expired or revoked session) so the app can send the user to sign in. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

/** The double-submit CSRF token the API set in the readable `gsc_csrf` cookie (empty if signed out). */
export function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const row = document.cookie.split('; ').find((r) => r.startsWith('gsc_csrf='));
  return row ? decodeURIComponent(row.slice('gsc_csrf='.length)) : '';
}

export function buildListQueryString(query: EmployeeListQueryInput): string {
  const p = new URLSearchParams();
  const csv = (v: unknown) =>
    Array.isArray(v) ? v.join(',') : v === undefined ? undefined : String(v);
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') p.set(k, v);
  };
  set('limit', query.limit === undefined ? undefined : String(query.limit));
  set('cursor', query.cursor);
  set('q', query.q?.trim());
  set('status', csv(query.status));
  set('employmentType', csv(query.employmentType));
  set('departmentId', query.departmentId);
  set('designationId', query.designationId);
  set('managerId', query.managerId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function createHttpEmployeesService({
  baseUrl,
  getCsrfToken = readCsrfToken,
  onUnauthorized,
  fetchImpl,
}: HttpServiceOptions): EmployeesService {
  const root = baseUrl.replace(/\/+$/, '');

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const doFetch = fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${root}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.method && init.method !== 'GET' ? { 'X-CSRF-Token': getCsrfToken() } : {}),
        },
      });
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (res.status === 401) onUnauthorized?.();
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      if (parsed.success) {
        const { code, message, details, requestId } = parsed.data.error;
        throw new ApiError(res.status, code, message, details, requestId);
      }
      throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
    }
    return body;
  }

  const json = (method: string, data: unknown): RequestInit => ({
    method,
    body: JSON.stringify(data),
  });
  const enc = encodeURIComponent;

  return {
    kind: 'http',
    async list(query) {
      return employeeListResponseSchema.parse(
        await request(`/employees${buildListQueryString(query)}`),
      );
    },
    async get(id) {
      return employeeResponseSchema.parse(await request(`/employees/${enc(id)}`)).data;
    },
    async create(input) {
      return employeeResponseSchema.parse(await request('/employees', json('POST', input))).data;
    },
    async update(id, input) {
      return employeeResponseSchema.parse(
        await request(`/employees/${enc(id)}`, json('PATCH', input)),
      ).data;
    },
    async changeStatus(id, input) {
      return employeeResponseSchema.parse(
        await request(`/employees/${enc(id)}/status`, json('PUT', input)),
      ).data;
    },
    async listDepartments() {
      return departmentListResponseSchema.parse(await request('/departments')).data;
    },
  };
}
