import { apiErrorSchema, meResponseSchema, ROLE_KEYS, type RoleKey } from '@gsc/contracts';
import { ApiError } from '../errors';
import type { Session } from '../permissions';

/**
 * Resolves the caller through `GET /api/v1/me` using the session cookie. Roles and permissions are taken verbatim from the API
 * (the database membership); nothing is defaulted or hardcoded here.
 */
export async function fetchSession(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<Session> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl.replace(/\/+$/, '')}/me`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details, requestId } = parsed.data.error;
      throw new ApiError(res.status, code, message, details, requestId);
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }
  const me = meResponseSchema.parse(body).data;
  const roleKey = me.roles.find((r): r is RoleKey => (ROLE_KEYS as readonly string[]).includes(r));
  if (!roleKey) throw new ApiError(403, 'FORBIDDEN', 'No recognised role for this company');
  return {
    displayName: me.name ?? me.email ?? 'Signed-in user',
    roleKey,
    employeeId: me.employeeId,
    permissions: me.permissions,
  };
}
