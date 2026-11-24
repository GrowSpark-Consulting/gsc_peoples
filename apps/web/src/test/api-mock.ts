import { ROLE_DEFAULT_PERMISSIONS, type RoleKey } from '@gsc/contracts';
import { vi } from 'vitest';

export interface MockReply {
  status?: number;
  body?: unknown;
}
export type Handler = MockReply | ((req: { method: string; path: string; body: unknown; query: URLSearchParams }) => MockReply);

const BASE = 'http://localhost:4000/api/v1';

export const ME_COMPANY = {
  name: 'Test Co',
  timezone: 'Asia/Kolkata',
  workingDays: [1, 2, 3, 4, 5],
  workStartTime: '09:00',
  workEndTime: '18:00',
};

/** `GET /me` body for a role, with the permissions the code grants that role by default. */
export function meBody(role: RoleKey, employeeId: string | null = 'emp-self') {
  return {
    data: {
      userId: 'user-1',
      employeeId,
      companyId: 'co-1',
      name: 'Test User',
      email: 'test@example.com',
      role,
      roles: [role],
      permissions: ROLE_DEFAULT_PERMISSIONS[role],
      dashboard: null,
      company: ME_COMPANY,
    },
  };
}

/**
 * Stubs `fetch` with `METHOD /path` handlers (path without the API base and query string). Unmatched requests
 * fail the test loudly with a 599 so a missing handler is never mistaken for an empty list.
 * Returns the stub; `calls()` lists `METHOD /path` strings in order.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown; query: URLSearchParams }[] = [];
  const stub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(new URL(BASE).pathname, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${path}`;
    // multipart bodies are recorded as { field: value } with files as { file: name, type, size }
    const body =
      init?.body instanceof FormData
        ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : { file: v.name, type: v.type, size: v.size }]))
        : init?.body
          ? JSON.parse(String(init.body))
          : undefined;
    calls.push({ key, body, query: url.searchParams });
    const h = routes[key];
    const reply: MockReply = h ? (typeof h === 'function' ? h({ method, path, body, query: url.searchParams }) : h) : { status: 599, body: { error: { code: 'UNMOCKED', message: `Unmocked request ${key}` } } };
    const status = reply.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => (status === 204 ? Promise.reject(new Error('no body')) : Promise.resolve(reply.body)),
      blob: () => Promise.resolve(new Blob(['x'])),
    } as unknown as Response);
  });
  vi.stubGlobal('fetch', stub);
  return { stub, calls, keys: () => calls.map((c) => c.key), last: (key: string) => [...calls].reverse().find((c) => c.key === key) };
}

export const apiError = (status: number, code: string, message: string): MockReply => ({
  status,
  body: { error: { code, message } },
});

export const page = (total: number) => ({ page: 1, pageSize: 25, total });
let n = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** A contract-valid employee as returned by `GET /employees`. */
export function employeeFixture(id: string, firstName: string, lastName: string, o: Record<string, unknown> = {}) {
  return {
    id,
    employeeNumber: 'EMP-0001',
    firstName,
    lastName,
    workEmail: `${firstName.toLowerCase()}@example.com`,
    jobTitle: 'Engineer',
    designation: null,
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    hireDate: '2024-01-01',
    terminationDate: null,
    department: null,
    manager: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...o,
  };
}
export const employeeList = (...employees: ReturnType<typeof employeeFixture>[]) => ({
  body: { data: employees, page: { limit: 100, nextCursor: null } },
});
