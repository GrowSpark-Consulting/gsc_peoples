import { Router } from 'express';
import type { MeCompany, MeResponse } from '@gsc/contracts';
import { dashboardForRole, isPermission, isRoleKey } from '@gsc/contracts';
import { UnauthorizedError } from '../../shared/errors';

/** Loads the caller's company configuration. Always called with the validated membership's company. */
export type CompanyLoader = (companyId: string) => Promise<MeCompany | null>;

/**
 * Mounted at /api/v1/me AFTER `authenticate` and `resolveTenant`. Read-only; returns exactly what the
 * validated membership grants. The only request data read is the validated session; company
 * configuration is loaded for that session's own company.
 */
export function createMeRouter(loadCompany?: CompanyLoader): Router {
  const router = Router();
  router.get('/', async (req, res) => {
    const u = req.user;
    if (!u) throw new UnauthorizedError();
    const roleKey = u.roles[0];
    const body: MeResponse = {
      data: {
        userId: u.userId,
        employeeId: u.employeeId,
        companyId: u.companyId,
        ...(u.email ? { email: u.email } : {}),
        ...(u.name ? { name: u.name } : {}),
        role: roleKey && isRoleKey(roleKey) ? roleKey : null,
        roles: u.roles,
        permissions: u.permissions.filter(isPermission),
        dashboard: roleKey ? dashboardForRole(roleKey) : null,
        company: loadCompany ? await loadCompany(u.companyId) : null,
      },
    };
    res.json(body);
  });
  return router;
}
