import type pg from 'pg';

/** Raw, schema-qualified seed helpers (run as hr_migrator). Explicit ids keep tests readable. */
export async function resetData(c: pg.Client) {
  await c.query(
    'TRUNCATE hr.company_memberships, hr.employees, hr.departments, hr.role_permissions, hr.roles, hr.users, hr.companies CASCADE',
  );
}

export const insertCompany = (c: pg.Client, id: string) =>
  c.query('INSERT INTO hr.companies (id, name, "updatedAt") VALUES ($1, $1, now())', [id]);

export const insertUser = (c: pg.Client, id: string, email = `${id}@example.com`) =>
  c.query(
    'INSERT INTO hr.users (id, "externalId", email, "updatedAt") VALUES ($1, $1, $2, now())',
    [id, email],
  );

export const insertRole = (c: pg.Client, id: string, companyId: string, key = 'EMPLOYEE') =>
  c.query(
    'INSERT INTO hr.roles (id, "companyId", key, name, "updatedAt") VALUES ($1, $2, $3, $3, now())',
    [id, companyId, key],
  );

export const insertDepartment = (c: pg.Client, id: string, companyId: string, name = id) =>
  c.query(
    'INSERT INTO hr.departments (id, "companyId", name, "updatedAt") VALUES ($1, $2, $3, now())',
    [id, companyId, name],
  );

export const insertEmployee = (
  c: pg.Client,
  e: {
    id: string;
    companyId: string;
    number?: string;
    managerId?: string | null;
    departmentId?: string | null;
  },
) =>
  c.query(
    `INSERT INTO hr.employees (id, "companyId", "employeeNumber", "firstName", "lastName", "managerId", "departmentId", "updatedAt")
     VALUES ($1, $2, $3, 'First', 'Last', $4, $5, now())`,
    [e.id, e.companyId, e.number ?? e.id, e.managerId ?? null, e.departmentId ?? null],
  );

export const insertMembership = (
  c: pg.Client,
  m: { id: string; companyId: string; userId: string; roleId: string; employeeId?: string | null },
) =>
  c.query(
    `INSERT INTO hr.company_memberships (id, "companyId", "userId", "roleId", "employeeId", status, "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now())`,
    [m.id, m.companyId, m.userId, m.roleId, m.employeeId ?? null],
  );
