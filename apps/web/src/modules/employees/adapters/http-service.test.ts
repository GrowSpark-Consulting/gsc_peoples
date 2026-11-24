import { describe, expect, it, vi } from 'vitest';
import { demoUuid } from './demo/demo-data';
import { ApiError } from '../errors';
import { buildListQueryString, createHttpEmployeesService } from './http-service';

const employee = {
  id: demoUuid(1),
  employeeNumber: 'GS-0001',
  firstName: 'A',
  lastName: 'B',
  workEmail: null,
  jobTitle: null,
  employmentType: 'FULL_TIME',
  status: 'ACTIVE',
  hireDate: null,
  terminationDate: null,
  department: null,
  manager: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function make(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  onUnauthorized?: () => void,
) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {}),
  );
  const service = createHttpEmployeesService({
    baseUrl: 'http://api.test/api/v1/',
    getCsrfToken: () => 'csrf-abc',
    onUnauthorized,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { service, fetchImpl };
}

describe('buildListQueryString', () => {
  it('serialises filters as the API expects (csv lists, no empties)', () => {
    expect(
      buildListQueryString({
        limit: 25,
        cursor: 'abc',
        q: '  kavya ',
        status: ['ACTIVE', 'ON_LEAVE'],
        employmentType: ['INTERN'],
        departmentId: demoUuid(1),
        managerId: '',
      }),
    ).toBe(
      `?limit=25&cursor=abc&q=kavya&status=ACTIVE%2CON_LEAVE&employmentType=INTERN&departmentId=${demoUuid(1)}`,
    );
    expect(buildListQueryString({})).toBe('');
  });
});

describe('http adapter (unit level, fake fetch; live coverage is in the Playwright live suites)', () => {
  it('authenticates with the session cookie (no bearer token) and parses a list response', async () => {
    const { service, fetchImpl } = make(() =>
      reply(200, { data: [employee], page: { limit: 25, nextCursor: null } }),
    );
    const r = await service.list({ q: 'a' });
    expect(r.data[0]?.employeeNumber).toBe('GS-0001');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/api/v1/employees?q=a');
    expect(init!.credentials).toBe('include');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-CSRF-Token']).toBeUndefined(); // reads need no CSRF token
  });

  it('sends the CSRF token on every write and on no read', async () => {
    const seen: [string | undefined, string | undefined][] = [];
    const { service } = make((_url, init) => {
      seen.push([init.method, (init.headers as Record<string, string>)['X-CSRF-Token']]);
      return reply(200, { data: employee });
    });
    await service.create({ employeeNumber: 'X', firstName: 'a', lastName: 'b', workEmail: 'a.b@example.test', joiningDate: '2026-01-05', departmentId: '11111111-1111-4111-8111-111111111111' });
    await service.update(employee.id, { jobTitle: 'x' });
    await service.changeStatus(employee.id, { status: 'TERMINATED', terminationDate: '2026-12-01' });
    expect(seen).toEqual([
      ['POST', 'csrf-abc'],
      ['PATCH', 'csrf-abc'],
      ['PUT', 'csrf-abc'],
    ]);
  });

  it('reports a 401 through onUnauthorized so the app can send the user to sign in', async () => {
    const onUnauthorized = vi.fn();
    const { service } = make(
      () => reply(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } }),
      onUnauthorized,
    );
    expect(await service.list({}).catch((e) => e)).toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('uses POST / PATCH / PUT with JSON bodies on the documented routes', async () => {
    const calls: [string, string | undefined, string | undefined][] = [];
    const { service } = make((url, init) => {
      calls.push([init.method, url, init.body as string | undefined] as never);
      return reply(200, { data: employee });
    });
    await service.create({ employeeNumber: 'X', firstName: 'a', lastName: 'b', workEmail: 'a.b@example.test', joiningDate: '2026-01-05', departmentId: '11111111-1111-4111-8111-111111111111' });
    await service.update(employee.id, { jobTitle: 'x' });
    await service.changeStatus(employee.id, {
      status: 'TERMINATED',
      terminationDate: '2026-12-01',
    });
    expect(
      calls.map((c) => `${c[0]} ${String(c[1]).replace('http://api.test/api/v1', '')}`),
    ).toEqual([
      'POST /employees',
      `PATCH /employees/${employee.id}`,
      `PUT /employees/${employee.id}/status`,
    ]);
    expect(JSON.parse(calls[2]![2]!)).toEqual({
      status: 'TERMINATED',
      terminationDate: '2026-12-01',
    });
  });

  it('maps the API error body (validation issues and conflict field) to ApiError', async () => {
    const { service } = make(() =>
      reply(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [{ path: ['workEmail'], message: 'Enter a valid email address' }],
          requestId: 'r1',
        },
      }),
    );
    const err = (await service
      .create({ employeeNumber: 'X', firstName: 'a', lastName: 'b', workEmail: 'a.b@example.test', joiningDate: '2026-01-05', departmentId: '11111111-1111-4111-8111-111111111111' })
      .catch((e) => e)) as ApiError;
    expect([err.status, err.code, err.requestId, err.fieldErrors]).toEqual([
      400,
      'VALIDATION_ERROR',
      'r1',
      { workEmail: 'Enter a valid email address' },
    ]);

    const { service: s2 } = make(() =>
      reply(409, {
        error: {
          code: 'CONFLICT',
          message: 'An employee with this work email already exists',
          details: { field: 'workEmail' },
        },
      }),
    );
    const c = (await s2
      .create({ employeeNumber: 'X', firstName: 'a', lastName: 'b', workEmail: 'a.b@example.test', joiningDate: '2026-01-05', departmentId: '11111111-1111-4111-8111-111111111111' })
      .catch((e) => e)) as ApiError;
    expect(c.fieldErrors).toEqual({ workEmail: 'An employee with this work email already exists' });
  });

  it('turns network failures and non-JSON errors into ApiError', async () => {
    const down = createHttpEmployeesService({
      baseUrl: 'http://x',
      fetchImpl: (() => Promise.reject(new TypeError('fail'))) as unknown as typeof fetch,
    });
    expect(await down.get(employee.id).catch((e) => e)).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    const { service } = make(() => new Response('<html>', { status: 502 }));
    expect(await service.get(employee.id).catch((e) => e)).toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
    });
  });

  it('rejects a response that violates the contract instead of trusting it', async () => {
    const { service } = make(() =>
      reply(200, {
        data: [{ ...employee, status: 'WHO_KNOWS' }],
        page: { limit: 25, nextCursor: null },
      }),
    );
    await expect(service.list({})).rejects.toThrow();
  });
});
