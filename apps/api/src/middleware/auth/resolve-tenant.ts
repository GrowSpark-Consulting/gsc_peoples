import type { RequestHandler } from 'express';
import { ALL_PERMISSIONS } from '@gsc/contracts';
import { runInTenantContext } from '../../database/tenant/request-context';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';

export interface ResolvedMembership {
  userId: string;
  membershipId: string;
  employeeId: string | null;
  roleKey: string;
  /** Raw `role_permissions.permission` strings for the role in this company. */
  permissions: string[];
}

/** Looks up the caller's ACTIVE membership in the company named by the VERIFIED token. */
export type MembershipResolver = (identity: {
  externalId: string;
  companyId: string;
}) => Promise<ResolvedMembership | null>;

/**
 * Establishes the tenant for the request.
 *
 * Company context comes only from a validated ACTIVE membership of an ACTIVE user, looked up with
 * the company claimed by the verified token (identity), never from headers, params, query or body.
 * Unknown permission strings in the database are dropped (registry allow-list).
 * Run after `authenticate`. Rejects with 403 when there is no active membership.
 */
export function resolveTenant(resolve: MembershipResolver): RequestHandler {
  const known = new Set<string>(ALL_PERMISSIONS);
  return async (req, _res, next) => {
    const identity = req.identity;
    if (!identity) throw new UnauthorizedError();

    const membership = await resolve({
      externalId: identity.externalId,
      companyId: identity.companyId,
    });
    if (!membership) throw new ForbiddenError('No active membership for this company');

    req.user = {
      userId: membership.userId,
      membershipId: membership.membershipId,
      employeeId: membership.employeeId,
      externalId: identity.externalId,
      email: identity.email,
      name: identity.name,
      companyId: identity.companyId,
      roles: [membership.roleKey],
      permissions: [...new Set(membership.permissions.filter((p) => known.has(p)))],
    };
    // Everything downstream of this point runs inside the caller's tenant context (RLS reads it).
    runInTenantContext(identity.companyId, () => next());
  };
}
