import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ROLE_KEYS, type RoleKey } from '@gsc/contracts';
import { z } from 'zod';

/**
 * PRD W1 company setup for a freshly migrated database: the company, the four fixed roles, the first Super Admin
 * (employee record + login), departments, designations, leave types, balances and the default onboarding checklist.
 *
 * Runs as the migration role from an operator's terminal (scripts/bootstrap-production.ts). It is not reachable
 * from the API. Everything happens in one transaction; it only inserts what is missing and never overwrites or
 * deletes business data, so running it again changes nothing and cannot undo later edits. One company per database
 * (A1): a second, differently named company is refused.
 *
 * The operator never handles the Super Admin's password: the account starts as INVITED with a single-use activation
 * link (the same invitation the application issues), and the person chooses their own password. While the account is
 * not activated, another run may issue a new link, which voids the earlier one.
 */

const name = (max: number) => z.string().trim().min(1).max(max);
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM');
const timezone = z.string().trim().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Must be a valid IANA timezone');

const unique = <T>(items: T[], key: (item: T) => string) => new Set(items.map((i) => key(i).toLowerCase())).size === items.length;
/** PRD LEAVE-001: these three are seeded. Their allowances are a business input (A4), so they have no default. */
export const REQUIRED_LEAVE_TYPES = ['Casual', 'Sick', 'Earned'] as const;

export const bootstrapConfigSchema = z
  .object({
    company: z
      .object({
        name: name(200),
        timezone,
        workingDays: z.array(z.int().min(1).max(7)).min(1).max(7).refine((d) => new Set(d).size === d.length, 'No repeated days').default([1, 2, 3, 4, 5]),
        workStartTime: time.default('09:00'),
        workEndTime: time.default('18:00'),
        logoUrl: z.url().regex(/^https:\/\//).nullable().optional(),
      })
      .strict()
      .refine((c) => c.workStartTime < c.workEndTime, { message: 'Work start time must be before end time', path: ['workEndTime'] }),
    superAdmin: z
      .object({
        firstName: name(100),
        lastName: name(100),
        workEmail: z.string().trim().toLowerCase().pipe(z.email()),
        joiningDate: z.iso.date().optional(),
        department: name(120),
        designation: name(120),
      })
      .strict(),
    departments: z.array(name(120)).min(1).refine((d) => unique(d, (x) => x), 'Department names must be unique'),
    designations: z.array(name(120)).min(1).refine((d) => unique(d, (x) => x), 'Designation names must be unique'),
    leaveTypes: z
      .array(
        z.object({ name: name(120), annualAllocation: z.number().min(0).max(366), isPaid: z.boolean(), allowHalfDay: z.boolean() }).strict(),
      )
      .min(1)
      .refine((t) => unique(t, (x) => x.name), 'Leave type names must be unique'),
    onboardingTasks: z
      .array(z.object({ title: name(200), dueOffsetDays: z.int().min(0).max(365).nullable().optional(), assigneeType: z.enum(['HR', 'EMPLOYEE']) }).strict())
      .min(1),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const required of REQUIRED_LEAVE_TYPES) {
      if (!c.leaveTypes.some((t) => t.name.toLowerCase().startsWith(required.toLowerCase()))) {
        ctx.addIssue({ code: 'custom', path: ['leaveTypes'], message: `Include the ${required} leave type (PRD LEAVE-001)` });
      }
    }
    const listed = (list: string[], value: string) => list.some((x) => x.toLowerCase() === value.toLowerCase());
    if (!listed(c.departments, c.superAdmin.department)) ctx.addIssue({ code: 'custom', path: ['superAdmin', 'department'], message: 'Must be one of departments' });
    if (!listed(c.designations, c.superAdmin.designation)) ctx.addIssue({ code: 'custom', path: ['superAdmin', 'designation'], message: 'Must be one of designations' });
  });

export type BootstrapConfig = z.output<typeof bootstrapConfigSchema>;

export interface BootstrapReport {
  dryRun: boolean;
  companyId: string;
  /** True while the Super Admin still has to activate the account. */
  awaitingActivation: boolean;
  created: Record<
    'company' | 'roles' | 'departments' | 'designations' | 'employees' | 'users' | 'memberships' | 'leaveTypes' | 'leaveBalances' | 'onboardingTasks',
    number
  >;
}

const ROLE_NAMES: Record<RoleKey, string> = { SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' };

/** Tables the run writes to. Their absence means the migrations have not been applied. */
const REQUIRED_TABLES = ['companies', 'roles', 'users', 'employees', 'company_memberships', 'designations', 'leave_types', 'leave_balances', 'onboarding_template_tasks', 'employee_number_sequences', 'audit_logs'];

export async function assertMigrated(client: pg.Client, expectedMigrations?: readonly string[]): Promise<void> {
  const { rows } = await client.query<{ name: string }>(`select table_name as name from information_schema.tables where table_schema = 'hr'`);
  const present = new Set(rows.map((r) => r.name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) throw new Error(`The database is not migrated (missing: ${missing.join(', ')}). Run the migrations first.`);
  if (!expectedMigrations) return;
  if (!present.has('_prisma_migrations')) throw new Error('The migration history table is missing. Apply the migrations with "prisma migrate deploy".');
  const done = await client.query<{ migration_name: string }>('select migration_name from hr._prisma_migrations where finished_at is not null and rolled_back_at is null');
  const applied = new Set(done.rows.map((r) => r.migration_name));
  const pending = expectedMigrations.filter((m) => !applied.has(m));
  if (pending.length > 0) throw new Error(`Migrations not applied: ${pending.join(', ')}`);
}

export interface BootstrapOptions {
  config: BootstrapConfig;
  /**
   * Activation link to register while the Super Admin has not activated the account: the HASH from the
   * application's own token module (the raw token stays with the caller).
   */
  invitation?: { tokenHash: string; expiresAt: Date };
  /** Roll everything back at the end and only report what would be created. */
  dryRun: boolean;
  now?: Date;
}

export async function bootstrapCompany(client: pg.Client, options: BootstrapOptions): Promise<BootstrapReport> {
  const config = bootstrapConfigSchema.parse(options.config);
  const now = options.now ?? new Date();
  const created: BootstrapReport['created'] = { company: 0, roles: 0, departments: 0, designations: 0, employees: 0, users: 0, memberships: 0, leaveTypes: 0, leaveBalances: 0, onboardingTasks: 0 };
  const one = async <T extends pg.QueryResultRow>(sql: string, params: unknown[]) => (await client.query<T>(sql, params)).rows[0];
  /** Returns the id of the row matched by `find`, inserting it first (and counting it) when missing. */
  async function ensure(counter: keyof typeof created, find: [string, unknown[]], insert: (id: string) => [string, unknown[]]): Promise<string> {
    const existing = await one<{ id: string }>(...find);
    if (existing) return existing.id;
    const id = randomUUID();
    await client.query(...insert(id));
    created[counter] += 1;
    return id;
  }

  await client.query('BEGIN');
  try {
    // Timestamps are stored without a zone and read as UTC, whatever the server or operator machine is set to.
    await client.query(`set local time zone 'UTC'`);
    // Two operators running this at once would otherwise both see an empty database.
    await client.query(`select pg_advisory_xact_lock(hashtextextended('hr.bootstrap', 0))`);
    const companies = (await client.query<{ id: string; name: string }>('select id, name from hr.companies')).rows;
    if (companies.length > 0 && !companies.some((c) => c.name === config.company.name)) {
      throw new Error('A different company already exists. This product holds one company per database; nothing was changed.');
    }
    const c = config.company;
    const companyId = await ensure('company', ['select id from hr.companies where name = $1', [c.name]], (id) => [
      `insert into hr.companies (id, name, "logoUrl", timezone, "workingDays", "workStartTime", "workEndTime", "updatedAt") values ($1,$2,$3,$4,$5,$6,$7,now())`,
      [id, c.name, c.logoUrl ?? null, c.timezone, c.workingDays, c.workStartTime, c.workEndTime],
    ]);

    const roles = {} as Record<RoleKey, string>;
    for (const key of ROLE_KEYS) {
      roles[key] = await ensure('roles', ['select id from hr.roles where "companyId" = $1 and key = $2', [companyId, key]], (id) => [
        `insert into hr.roles (id, "companyId", key, name, "isSystem", "updatedAt") values ($1,$2,$3,$4,true,now())`,
        [id, companyId, key, ROLE_NAMES[key]],
      ]);
    }

    const named = async (table: 'departments' | 'designations' | 'leave_types', counter: keyof typeof created, value: string, insert: (id: string) => [string, unknown[]]) =>
      ensure(counter, [`select id from hr.${table} where "companyId" = $1 and lower(name) = lower($2)`, [companyId, value]], insert);

    const departments = new Map<string, string>();
    for (const d of config.departments) {
      departments.set(d.toLowerCase(), await named('departments', 'departments', d, (id) => [`insert into hr.departments (id, "companyId", name, "updatedAt") values ($1,$2,$3,now())`, [id, companyId, d]]));
    }
    const designations = new Map<string, string>();
    for (const d of config.designations) {
      designations.set(d.toLowerCase(), await named('designations', 'designations', d, (id) => [`insert into hr.designations (id, "companyId", name, "updatedAt") values ($1,$2,$3,now())`, [id, companyId, d]]));
    }

    const admin = config.superAdmin;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: c.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    let employee = await one<{ id: string }>('select id from hr.employees where "companyId" = $1 and "workEmail" = $2', [companyId, admin.workEmail]);
    if (!employee) {
      const sequence = await one<{ n: number }>(
        `insert into hr.employee_number_sequences as s (id, "companyId", "nextValue", "updatedAt") values ($1,$2,2,now())
         on conflict ("companyId") do update set "nextValue" = s."nextValue" + 1, "updatedAt" = now() returning "nextValue" - 1 as n`,
        [randomUUID(), companyId],
      );
      const id = randomUUID();
      const joined = admin.joiningDate ?? today;
      await client.query(
        `insert into hr.employees (id, "companyId", "employeeNumber", "firstName", "lastName", "workEmail", status, "joiningDate", "hireDate", "departmentId", "designationId", "updatedAt")
         values ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7,$8,$9,now())`,
        [id, companyId, `EMP-${String(sequence!.n).padStart(4, '0')}`, admin.firstName, admin.lastName, admin.workEmail, joined, departments.get(admin.department.toLowerCase()), designations.get(admin.designation.toLowerCase())],
      );
      created.employees += 1;
      employee = { id };
    }

    // An existing login keeps its password: this tool never sets or resets one.
    const userId = await ensure('users', ['select id from hr.users where email = $1', [admin.workEmail]], (id) => [
      `insert into hr.users (id, "externalId", email, name, status, "updatedAt") values ($1,$2,$3,$4,'ACTIVE',now())`,
      [id, `local:${id}`, admin.workEmail, `${admin.firstName} ${admin.lastName}`],
    ]);
    const membershipId = await ensure('memberships', ['select id from hr.company_memberships where "companyId" = $1 and "userId" = $2', [companyId, userId]], (id) => [
      `insert into hr.company_memberships (id, "companyId", "userId", "roleId", "employeeId", status, "invitedAt", "updatedAt") values ($1,$2,$3,$4,$5,'INVITED',now(),now())`,
      [id, companyId, userId, roles.SUPER_ADMIN, employee.id],
    ]);
    const awaitingActivation = (await one<{ status: string }>('select status from hr.company_memberships where id = $1', [membershipId]))!.status === 'INVITED';
    if (awaitingActivation && options.invitation) {
      await client.query('update hr.invitation_tokens set "revokedAt" = now() where "membershipId" = $1 and "usedAt" is null and "revokedAt" is null', [membershipId]);
      await client.query('insert into hr.invitation_tokens (id, "companyId", "userId", "membershipId", "tokenHash", "expiresAt") values ($1,$2,$3,$4,$5,$6)', [
        randomUUID(), companyId, userId, membershipId, options.invitation.tokenHash, options.invitation.expiresAt.toISOString(),
      ]);
    }

    const year = Number(today.slice(0, 4));
    for (const type of config.leaveTypes) {
      const typeId = await named('leave_types', 'leaveTypes', type.name, (id) => [
        `insert into hr.leave_types (id, "companyId", name, "annualAllocation", "isPaid", "allowHalfDay", "updatedAt") values ($1,$2,$3,$4,$5,$6,now())`,
        [id, companyId, type.name, type.annualAllocation, type.isPaid, type.allowHalfDay],
      ]);
      await ensure('leaveBalances', ['select id from hr.leave_balances where "companyId" = $1 and "employeeId" = $2 and "leaveTypeId" = $3 and year = $4', [companyId, employee.id, typeId, year]], (id) => [
        `insert into hr.leave_balances (id, "companyId", "employeeId", "leaveTypeId", year, allocated, "updatedAt") select $1,$2,$3,$4,$5,"annualAllocation",now() from hr.leave_types where id = $4`,
        [id, companyId, employee.id, typeId, year],
      ]);
    }

    for (const task of config.onboardingTasks) {
      await ensure('onboardingTasks', ['select id from hr.onboarding_template_tasks where "companyId" = $1 and lower(title) = lower($2)', [companyId, task.title]], (id) => [
        `insert into hr.onboarding_template_tasks (id, "companyId", title, "dueOffsetDays", "assigneeType", "updatedAt") values ($1,$2,$3,$4,$5,now())`,
        [id, companyId, task.title, task.dueOffsetDays ?? null, task.assigneeType],
      ]);
    }

    if (Object.values(created).some((n) => n > 0)) {
      await client.query(`insert into hr.audit_logs (id, "companyId", "actorId", action, entity, "entityId", "newValue") values ($1,$2,$3,'COMPANY_BOOTSTRAPPED','company',$2,$4)`, [
        randomUUID(),
        companyId,
        userId,
        JSON.stringify({ created }),
      ]);
    }

    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
    return { dryRun: options.dryRun, companyId, awaitingActivation, created };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}
