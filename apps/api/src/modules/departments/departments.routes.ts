import { Router, type RequestHandler } from 'express';
import { PERMISSIONS } from '@gsc/contracts';
import { requireAnyPermission } from '../../middleware/authorization/authorize';
import { UnauthorizedError } from '../../shared/errors';
import type { DepartmentRepository } from './departments.repository';

/**
 * Read-only department options for filters and assignment dropdowns. Mounted at
 * /api/v1/departments after `authenticate` and `resolveTenant`.
 */
export function createDepartmentsRouter(repository: DepartmentRepository): Router {
  const list: RequestHandler = async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    res.json({ data: await repository.listActive({ companyId: req.user.companyId }) });
  };

  const router = Router();
  router.get(
    '/',
    // PRD section 5: departments are viewable by every role (ORG-002).
    requireAnyPermission(PERMISSIONS.ORG_READ, PERMISSIONS.EMPLOYEE_READ_ALL, PERMISSIONS.EMPLOYEE_WRITE),
    list,
  );
  return router;
}
