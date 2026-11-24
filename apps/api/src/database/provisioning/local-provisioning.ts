import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, ROLE_KEYS, type RoleKey } from '@gsc/contracts';

/**
 * LOCAL DEVELOPMENT PROVISIONING (not an admin feature, not an API).
 *
 * Runs as the migration role (`hr_migrator`) from a CLI on the developer's machine. It is the only
 * code that writes users, roles and memberships, and it is never reachable from the browser or the
 * API process. It is insert-only and idempotent: every row is keyed by a natural unique key and
 * `ON CONFLICT DO NOTHING`, so a second run creates nothing and never overwrites edits made later.
 */

export const LOCAL_DATABASES = ['hr_db', 'hr_test'] as const;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Refuses anything that is not a localhost PostgreSQL with a known local database name. */
export function assertLocalTarget(connectionUrl: string): { host: string; database: string } {
  const url = new URL(connectionUrl);
  const database = url.pathname.slice(1);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `SAFEGUARD: refusing to provision host "${url.hostname}". Local provisioning only runs against localhost.`,
    );
  }
  if (!(LOCAL_DATABASES as readonly string[]).includes(database)) {
    throw new Error(
      `SAFEGUARD: refusing to provision database "${database}". Allowed: ${LOCAL_DATABASES.join(', ')}.`,
    );
  }
  return { host: url.hostname, database };
}

export interface LocalPerson {
  /** Central Authentication subject (`users.externalId`). The dev token is `dev:<externalId>`. */
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  jobTitle: string;
  roleKey: RoleKey;
  /** `employeeNumber` of this person's manager, if any. */
  managerNumber?: string;
  department?: string;
}

export interface LocalProvisionSpec {
  companyId: string;
  companyName: string;
  departments: string[];
  people: LocalPerson[];
}

export const DEFAULT_DEPARTMENTS = ['Engineering', 'People & Operations'];

export const DEFAULT_PEOPLE: LocalPerson[] = [
  {
    externalId: 'dev-hr-admin',
    email: 'hana.admin@dev.local',
    firstName: 'Hana',
    lastName: 'Admin',
    employeeNumber: 'EMP-001',
    jobTitle: 'HR Lead',
    roleKey: 'HR_ADMIN',
    department: 'People & Operations',
  },
  {
    externalId: 'dev-manager',
    email: 'mia.manager@dev.local',
    firstName: 'Mia',
    lastName: 'Manager',
    employeeNumber: 'EMP-002',
    jobTitle: 'Engineering Manager',
    roleKey: 'MANAGER',
    department: 'Engineering',
  },
  {
    externalId: 'dev-employee',
    email: 'ravi.reddy@dev.local',
    firstName: 'Ravi',
    lastName: 'Reddy',
    employeeNumber: 'EMP-003',
    jobTitle: 'Software Engineer',
    roleKey: 'EMPLOYEE',
    managerNumber: 'EMP-002',
    department: 'Engineering',
  },
  {
    externalId: 'dev-super-admin',
    email: 'sam.superadmin@dev.local',
    firstName: 'Sam',
    lastName: 'Superadmin',
    employeeNumber: 'EMP-004',
    jobTitle: 'Founder',
    roleKey: 'SUPER_ADMIN',
    department: 'People & Operations',
  },
];

export function defaultSpec(companyId: string): LocalProvisionSpec {
  return {
    companyId,
    companyName: 'Grow Spark Dev Co',
    departments: DEFAULT_DEPARTMENTS,
    people: DEFAULT_PEOPLE,
  };
}

export interface ProvisionReport {
  created: Record<
    'company' | 'roles' | 'rolePermissions' | 'departments' | 'users' | 'employees' | 'memberships',
    number
  >;
  /** role key -> permissions present in the DB for the company but not in the registry defaults. */
  extraPermissions: Record<string, string[]>;
}

const ROLE_NAMES: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR_ADMIN: 'HR Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

// Referenced so the registry import stays the single source of permission strings.
void PERMISSIONS;

/**
 * Creates or reuses the company, system roles with default permissions, departments, users,
 * employees (with reporting lines) and ACTIVE memberships. One transaction: all or nothing.
 */
export async function provisionLocal(
  client: pg.Client,
  spec: LocalProvisionSpec,
): Promise<ProvisionReport> {
  const created: ProvisionReport['created'] = {
    company: 0,
    roles: 0,
    rolePermissions: 0,
    departments: 0,
    users: 0,
    employees: 0,
    memberships: 0,
  };
  const count = (r: pg.QueryResult) => r.rowCount ?? 0;
  const { companyId } = spec;

  await client.query('BEGIN');
  try {
    created.company += count(
      await client.query(
        `INSERT INTO hr.companies (id, name, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING`,
        [companyId, spec.companyName],
      ),
    );

    // Roles + default permissions (insert-only: never revokes a grant someone added or removed).
    const roleIds = new Map<RoleKey, string>();
    for (const key of ROLE_KEYS) {
      created.roles += count(
        await client.query(
          `INSERT INTO hr.roles (id, "companyId", key, name, "isSystem", "updatedAt")
           VALUES ($1, $2, $3, $4, true, now()) ON CONFLICT ("companyId", key) DO NOTHING`,
          [randomUUID(), companyId, key, ROLE_NAMES[key]],
        ),
      );
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hr.roles WHERE "companyId" = $1 AND key = $2`,
        [companyId, key],
      );
      const roleId = rows[0]!.id;
      roleIds.set(key, roleId);
      for (const permission of ROLE_DEFAULT_PERMISSIONS[key]) {
        created.rolePermissions += count(
          await client.query(
            `INSERT INTO hr.role_permissions (id, "companyId", "roleId", permission)
             VALUES ($1, $2, $3, $4) ON CONFLICT ("companyId", "roleId", permission) DO NOTHING`,
            [randomUUID(), companyId, roleId, permission],
          ),
        );
      }
    }

    const departmentIds = new Map<string, string>();
    for (const name of spec.departments) {
      created.departments += count(
        await client.query(
          `INSERT INTO hr.departments (id, "companyId", name, "updatedAt")
           VALUES ($1, $2, $3, now()) ON CONFLICT ("companyId", name) DO NOTHING`,
          [randomUUID(), companyId, name],
        ),
      );
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hr.departments WHERE "companyId" = $1 AND name = $2`,
        [companyId, name],
      );
      departmentIds.set(name, rows[0]!.id);
    }

    // Employees first without managers, then reporting lines for rows this run created.
    const employeeIds = new Map<string, string>();
    const newEmployees = new Set<string>();
    for (const p of spec.people) {
      const inserted = count(
        await client.query(
          `INSERT INTO hr.employees (id, "companyId", "employeeNumber", "firstName", "lastName", "workEmail",
             "jobTitle", status, "hireDate", "departmentId", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', DATE '2024-01-15', $8, now())
           ON CONFLICT ("companyId", "employeeNumber") DO NOTHING`,
          [
            randomUUID(),
            companyId,
            p.employeeNumber,
            p.firstName,
            p.lastName,
            p.email,
            p.jobTitle,
            p.department ? (departmentIds.get(p.department) ?? null) : null,
          ],
        ),
      );
      created.employees += inserted;
      if (inserted) newEmployees.add(p.employeeNumber);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hr.employees WHERE "companyId" = $1 AND "employeeNumber" = $2`,
        [companyId, p.employeeNumber],
      );
      employeeIds.set(p.employeeNumber, rows[0]!.id);
    }
    for (const p of spec.people) {
      if (!p.managerNumber || !newEmployees.has(p.employeeNumber)) continue;
      const managerId = employeeIds.get(p.managerNumber);
      if (!managerId) throw new Error(`Unknown manager ${p.managerNumber} for ${p.employeeNumber}`);
      await client.query(
        `UPDATE hr.employees SET "managerId" = $3, "updatedAt" = now()
         WHERE "companyId" = $1 AND "employeeNumber" = $2`,
        [companyId, p.employeeNumber, managerId],
      );
    }

    for (const p of spec.people) {
      created.users += count(
        await client.query(
          `INSERT INTO hr.users (id, "externalId", email, name, "updatedAt")
           VALUES ($1, $2, lower(btrim($3)), $4, now()) ON CONFLICT ("externalId") DO NOTHING`,
          [randomUUID(), p.externalId, p.email, `${p.firstName} ${p.lastName}`],
        ),
      );
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM hr.users WHERE "externalId" = $1`,
        [p.externalId],
      );
      created.memberships += count(
        await client.query(
          `INSERT INTO hr.company_memberships (id, "companyId", "userId", "roleId", "employeeId", status, "joinedAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now(), now()) ON CONFLICT ("companyId", "userId") DO NOTHING`,
          [
            randomUUID(),
            companyId,
            rows[0]!.id,
            roleIds.get(p.roleKey),
            employeeIds.get(p.employeeNumber),
          ],
        ),
      );
    }

    // Report (never silently fix) grants that differ from the registry defaults.
    const extraPermissions: Record<string, string[]> = {};
    const { rows: grants } = await client.query<{ key: string; permission: string }>(
      `SELECT r.key, rp.permission FROM hr.role_permissions rp
       JOIN hr.roles r ON r."companyId" = rp."companyId" AND r.id = rp."roleId"
       WHERE rp."companyId" = $1`,
      [companyId],
    );
    for (const g of grants) {
      const defaults = ROLE_DEFAULT_PERMISSIONS[g.key as RoleKey] as readonly string[] | undefined;
      if (!defaults?.includes(g.permission)) (extraPermissions[g.key] ??= []).push(g.permission);
    }

    await client.query('COMMIT');
    return { created, extraPermissions };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
