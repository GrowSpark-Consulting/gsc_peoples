import { Router } from 'express';
import {
  PERMISSIONS,
  changeEmployeeStatusSchema,
  createEmployeeSchema,
  employeeIdParamSchema,
  employeeListQuerySchema,
  employeeSelfUpdateSchema,
  updateEmployeeSchema,
} from '@gsc/contracts';
import { requireAnyPermission, requirePermission } from '../../middleware/authorization/authorize';
import { validate } from '../../middleware/validation/validate';
import { createEmployeeController } from './employees.controller';
import type { EmployeeService } from './employees.service';

const canRead = requireAnyPermission(
  PERMISSIONS.EMPLOYEE_READ_ALL,
  PERMISSIONS.EMPLOYEE_READ_TEAM,
  PERMISSIONS.EMPLOYEE_READ_SELF,
);

/**
 * Mounted at /api/v1/employees AFTER `authenticate` and `resolveTenant`.
 * The permission gate runs before validation (so unauthorised callers get 403, not validation
 * detail); the service re-checks and decides read scope (all / team / self).
 */
export function createEmployeesRouter(service: EmployeeService): Router {
  const c = createEmployeeController(service);
  const router = Router();

  router.get('/', canRead, validate({ query: employeeListQuerySchema }), c.list);
  router.get('/me', canRead, c.getMe);
  router.patch(
    '/me',
    requirePermission(PERMISSIONS.EMPLOYEE_SELF_EDIT),
    validate({ body: employeeSelfUpdateSchema }),
    c.selfUpdate,
  );

  router.post(
    '/',
    requirePermission(PERMISSIONS.EMPLOYEE_WRITE),
    validate({ body: createEmployeeSchema }),
    c.create,
  );

  router.get('/:id/timeline', canRead, validate({ params: employeeIdParamSchema }), c.timeline);
  router.post(
    '/:id/invite',
    requireAnyPermission(PERMISSIONS.EMPLOYEE_INVITE, PERMISSIONS.USER_ACCOUNT_MANAGE),
    validate({ params: employeeIdParamSchema }),
    c.invite,
  );

  router.get('/:id', canRead, validate({ params: employeeIdParamSchema }), c.get);
  router.patch(
    '/:id',
    requirePermission(PERMISSIONS.EMPLOYEE_WRITE),
    validate({ params: employeeIdParamSchema, body: updateEmployeeSchema }),
    c.update,
  );
  router.put(
    '/:id/status',
    requirePermission(PERMISSIONS.EMPLOYEE_STATUS_WRITE),
    validate({ params: employeeIdParamSchema, body: changeEmployeeStatusSchema }),
    c.changeStatus,
  );
  return router;
}
