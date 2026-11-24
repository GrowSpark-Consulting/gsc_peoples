import type { TenantContext } from '../../database/tenant/types';
import type { TenantRunner } from '../employees/employees.repository';

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface DepartmentRepository {
  /** Active departments of the caller's company, by name. Read-only (CRUD is a later phase). */
  listActive(ctx: TenantContext): Promise<DepartmentOption[]>;
}

export function createDepartmentRepository(run: TenantRunner): DepartmentRepository {
  return {
    listActive: (ctx) =>
      run(ctx, (db) =>
        db.department.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        }),
      ),
  };
}
