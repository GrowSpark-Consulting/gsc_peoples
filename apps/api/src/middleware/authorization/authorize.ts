import type { RequestHandler } from 'express';
import { can, type Action, type AuthzUser } from '@gsc/contracts';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors';

/** Requires the user to hold at least one of the given roles. Run after authenticate. */
export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.some((r) => req.user!.roles.includes(r))) throw new ForbiddenError();
    next();
  };

/** Requires the user to hold every given permission. Run after authenticate. */
export const requirePermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!permissions.every((p) => req.user!.permissions.includes(p))) throw new ForbiddenError();
    next();
  };

/** Requires the user to hold at least one of the given permissions. Run after resolveTenant. */
export const requireAnyPermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!permissions.some((p) => req.user!.permissions.includes(p))) throw new ForbiddenError();
    next();
  };

/** The caller as the shared `can()` helper sees it. Built only from the validated membership. */
export function toAuthzUser(user: NonNullable<Express.Request['user']>): AuthzUser {
  return {
    userId: user.userId,
    companyId: user.companyId,
    employeeId: user.employeeId,
    roles: user.roles,
    permissions: user.permissions,
  };
}

/**
 * Route gate backed by the shared `can(user, action, resource)` helper (PRD section 5). Use for actions
 * whose rule does not depend on a specific row; row-level checks call `can()` in the service.
 * Run after resolveTenant. 401 without a caller, 403 when `can()` says no.
 */
export const requireCan =
  (action: Action): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new UnauthorizedError();
    if (!can(toAuthzUser(req.user), action)) throw new ForbiddenError();
    next();
  };
