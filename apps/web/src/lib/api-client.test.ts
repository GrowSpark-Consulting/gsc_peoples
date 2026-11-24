import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/modules/employees/errors';
import { apiRequest, buildQuery, describeApiError } from './api-client';

const reply = (status: number, body?: unknown) =>
  vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => (body === undefined ? Promise.reject(new Error('empty')) : Promise.resolve(body)),
    } as unknown as Response),
  );

afterEach(() => vi.unstubAllGlobals());

describe('buildQuery', () => {
  it('skips empty values and joins arrays with commas', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: null, e: ['x', 'y'], f: true })).toBe('?a=1&e=x%2Cy&f=true');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
  });
});

describe('apiRequest with FormData', () => {
  it('passes a multipart body through untouched and leaves Content-Type to the browser (boundary)', async () => {
    vi.stubGlobal('document', { cookie: 'gsc_csrf=tok' });
    const form = new FormData();
    form.set('category', 'ID_PROOF');
    const post = reply(201, { ok: true });
    await apiRequest('/documents/employee', { method: 'POST', body: form, fetchImpl: post });
    const [, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
  });
});

describe('apiRequest', () => {
  it('sends the session cookie, never an identity, and a CSRF token only on writes', async () => {
    vi.stubGlobal('document', { cookie: 'gsc_csrf=tok%20en' });
    const get = reply(200, { n: 1 });
    await apiRequest('/x', { fetchImpl: get, baseUrl: 'http://api.test/v1/' });
    const [url, init] = get.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/v1/x');
    expect(init.credentials).toBe('include');
    expect(init.headers).not.toHaveProperty('X-CSRF-Token');
    expect(init.headers).not.toHaveProperty('Authorization');

    const post = reply(201, { ok: true });
    await apiRequest('/x', { method: 'POST', body: { a: 1 }, fetchImpl: post });
    const [, pinit] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect((pinit.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok en');
    expect(pinit.body).toBe('{"a":1}');
  });

  it('validates the response against the contract', async () => {
    const ok = await apiRequest('/x', { fetchImpl: reply(200, { n: 1 }), schema: z.object({ n: z.number() }) });
    expect(ok).toEqual({ n: 1 });
    await expect(
      apiRequest('/x', { fetchImpl: reply(200, { n: 'nope' }), schema: z.object({ n: z.number() }) }),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('maps API errors (403, 404, 409, 422, 500) to ApiError with the server code and message', async () => {
    for (const status of [403, 404, 409, 422, 500]) {
      const f = reply(status, { error: { code: `E${status}`, message: `m${status}`, requestId: 'r1' } });
      await expect(apiRequest('/x', { fetchImpl: f })).rejects.toMatchObject({ status, code: `E${status}`, message: `m${status}`, requestId: 'r1' });
    }
    await expect(apiRequest('/x', { fetchImpl: reply(502, 'oops') })).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('reports a network failure and returns undefined for 204', async () => {
    const down = vi.fn(() => Promise.reject(new TypeError('fail')));
    await expect(apiRequest('/x', { fetchImpl: down as unknown as typeof fetch })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(await apiRequest('/x', { method: 'DELETE', fetchImpl: reply(204) })).toBeUndefined();
  });

  it('sends the user to sign in on 401', async () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });
    await expect(apiRequest('/x', { fetchImpl: reply(401, { error: { code: 'UNAUTHORIZED', message: 'no' } }) })).rejects.toBeInstanceOf(ApiError);
    expect(replace).toHaveBeenCalledWith('/login');
  });
});

describe('describeApiError', () => {
  it('gives safe, specific messages', () => {
    expect(describeApiError(new ApiError(0, 'NETWORK_ERROR', 'x'))).toMatch(/Could not reach/);
    expect(describeApiError(new ApiError(403, 'FORBIDDEN', 'x'))).toMatch(/permission/);
    expect(describeApiError(new ApiError(404, 'NOT_FOUND', 'x'))).toMatch(/could not be found/);
    expect(describeApiError(new ApiError(413, 'X', 'x'))).toMatch(/too large/);
    expect(describeApiError(new ApiError(500, 'X', 'stack trace'))).not.toMatch(/stack/);
    expect(describeApiError(new ApiError(409, 'CONFLICT', 'Already checked in today'))).toBe('Already checked in today');
    expect(describeApiError(new Error('boom'))).toMatch(/Something went wrong/);
  });
});
