import type { Permission } from '@gsc/contracts';
import { ACTIONS, can as canContract, type Action, type AuthzResource, type AuthzUser } from '@gsc/contracts';
import type { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors';

export type AuthSubject = {
  userId: string;
  companyId: string;
  employeeId?: string | null;
  roles: readonly string[];
  permissions: readonly string[];
};

export function can(user: AuthSubject | null | undefined, action: Permission | string, resource?: unknown): boolean {
  if (!user) return false;
  // Named actions go through the shared contract rules; anything else is a plain permission string.
  if ((ACTIONS as readonly string[]).includes(action)) {
    return canContract(user as AuthzUser, action as Action, resource as AuthzResource | undefined);
  }
  return user.permissions.includes(action);
}

export function requireCan(req: Request, action: Permission | string, resource?: unknown): asserts req is Request & { user: NonNullable<Request['user']> } {
  if (!req.user) throw new UnauthorizedError('Authentication required');
  if (!can(req.user as AuthSubject, action, resource)) {
    throw new ForbiddenError(`Missing permission: ${action}`);
  }
}
