import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bindTenant, connect, failure } from './helpers';
import { insertCompany, insertEmployee, resetData } from './seed';

let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = await connect('TEST_DIRECT_URL');
  app = await connect('TEST_DATABASE_URL');
  await bindTenant(app, 'c1'); // RLS: hr_app sees and writes only the tenant it is bound to
});
afterAll(async () => {
  await app.end();
  await admin.end();
});
beforeEach(async () => {
  await resetData(admin);
  await insertCompany(admin, 'c1');
});

// Tables created by THIS migration (the audit-log candidate is reviewed separately).
const MINE = [
  'users',
  'roles',
  'role_permissions',
  'departments',
  'company_memberships',
  'employees',
];
/** Schema-qualified relation name that does not depend on the session/role search_path (regclass::text does). */
const qualified = (col: string) =>
  `(SELECT format('%I.%I', n.nspname, c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = ${col})`;
const qualifiedFn = (col: string) =>
  `(SELECT format('%I.%I', n.nspname, p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = ${col})`;
const inMine = `ANY(ARRAY[${MINE.map((t) => `'hr.${t}'`).join(',')}]::regclass[])`;

const q = async <T extends object>(sql: string, params: unknown[] = []) =>
  (await admin.query<T>(sql, params)).rows;

describe('pg_constraint: CHECK constraints', () => {
  it('exactly the expected CHECK constraints exist (9 original + 8 from the P0 migration + 8 for identity documents), validated, with the intended expressions', async () => {
    const rows = await q<{ conrelid: string; conname: string; def: string; convalidated: boolean }>(
      `SELECT ${qualified('conrelid')} AS conrelid, conname, pg_get_constraintdef(oid) AS def, convalidated
       FROM pg_constraint WHERE connamespace = 'hr'::regnamespace AND contype = 'c' ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      'attendance_corrections_out_after_in',
      'attendance_records_out_after_in',
      'companies_timezone_not_blank',
      'companies_working_days_valid',
      'companies_working_hours_valid',
      'employee_documents_owner_matches_flag',
      'employee_documents_size_max',
      'employee_documents_size_positive',
      'employee_identity_documents_back_complete',
      'employee_identity_documents_back_required',
      'employee_identity_documents_back_size',
      'employee_identity_documents_ciphertext',
      'employee_identity_documents_front_size',
      'employee_identity_documents_last4',
      'employee_identity_documents_mime',
      'employee_identity_documents_purge_after_delete',
      'employees_no_self_manager',
      'employees_terminated_requires_termination_date',
      'employees_termination_after_hire',
      'employees_work_email_normalized',
      'holidays_name_not_blank',
      'leave_requests_dates_valid',
      'leave_requests_days_positive',
      'leave_requests_half_day_valid',
      'users_email_normalized',
    ]);
    expect(rows.every((r) => r.convalidated)).toBe(true);
    const def = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
    expect(def.employees_terminated_requires_termination_date).toMatch(
      /status.*<>.*'TERMINATED'.*OR.*"terminationDate" IS NOT NULL/s,
    );
    expect(def.employees_termination_after_hire).toMatch(/"terminationDate" >= "hireDate"/);
    expect(def.employees_work_email_normalized).toMatch(
      /"workEmail" = lower\(btrim\("workEmail"\)\)/,
    );
    expect(def.users_email_normalized).toMatch(/email = lower\(btrim\(email\)\)/);
    expect(
      rows
        .filter((r) => r.conname.startsWith('employees_'))
        .every((r) => r.conrelid === 'hr.employees'),
    ).toBe(true);
  });
});

describe('pg_trigger / pg_proc: manager-cycle trigger', () => {
  it('is one enabled BEFORE INSERT OR UPDATE OF managerId row trigger on hr.employees', async () => {
    const rows = await q<{
      tgname: string;
      tgenabled: string;
      tgtype: number;
      rel: string;
      fn: string;
      def: string;
    }>(
      `SELECT tgname, tgenabled, tgtype, ${qualified('tgrelid')} AS rel, ${qualifiedFn('tgfoid')} AS fn, pg_get_triggerdef(oid) AS def
       FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'hr.employees'::regclass`,
    );
    expect(rows).toHaveLength(1);
    const t = rows[0]!;
    expect([t.tgname, t.tgenabled, t.rel, t.fn]).toEqual([
      'employees_no_manager_cycle',
      'O',
      'hr.employees',
      'hr.employees_prevent_manager_cycle',
    ]);
    // tgtype bits: ROW=1, BEFORE=2, INSERT=4, UPDATE=16
    expect(t.tgtype & 1).toBe(1);
    expect(t.tgtype & 2).toBe(2);
    expect(t.tgtype & 4).toBe(4);
    expect(t.tgtype & 16).toBe(16);
    expect(t.tgtype & 8).toBe(0); // not DELETE
    expect(t.def).toMatch(/BEFORE INSERT OR UPDATE OF "managerId" ON (hr\.)?employees/);
  });

  it('the function lives in schema hr, is SECURITY INVOKER, and pins its own search_path', async () => {
    const [fn] = await q<{
      schema: string;
      secdef: boolean;
      lang: string;
      config: string[];
      src: string;
    }>(
      `SELECT n.nspname AS schema, p.prosecdef AS secdef, l.lanname AS lang, p.proconfig AS config, p.prosrc AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
       WHERE p.proname = 'employees_prevent_manager_cycle'`,
    );
    expect(fn).toBeDefined();
    expect(fn!.schema).toBe('hr');
    expect(fn!.secdef).toBe(false);
    expect(fn!.lang).toBe('plpgsql');
    expect(fn!.config).toEqual(['search_path=hr, pg_temp']);
    // Every table reference inside the body is schema-qualified.
    expect(fn!.src).not.toMatch(/(FROM|JOIN)\s+"employees"/);
    expect(fn!.src.match(/"hr"\."employees"/g)).toHaveLength(2);
  });

  it('works for a session whose search_path does NOT include hr (qualification, not luck)', async () => {
    const c = await connect('TEST_DATABASE_URL');
    await bindTenant(c, 'c1');
    try {
      // Force the condition under test instead of relying on the role setting (Supabase roles have search_path=hr).
      await c.query('SET search_path = public');
      const { rows } = await c.query('SHOW search_path');
      expect(rows[0].search_path).not.toMatch(/\bhr\b/);
      await insertEmployee(admin, { id: 'A', companyId: 'c1' });
      await insertEmployee(admin, { id: 'B', companyId: 'c1' });
      await c.query("UPDATE hr.employees SET \"managerId\" = 'B' WHERE id = 'A'");
      const err = await failure(() =>
        c.query("UPDATE hr.employees SET \"managerId\" = 'A' WHERE id = 'B'"),
      );
      expect(err.code).toBe('23514');
    } finally {
      await c.end();
    }
  });
});

describe('pg_constraint / pg_indexes: keys and indexes', () => {
  it('has the 12 composite/simple foreign keys with the reviewed delete/update actions', async () => {
    const rows = await q<{ conname: string; del: string; upd: string; cols: number }>(
      `SELECT conname, confdeltype AS del, confupdtype AS upd, cardinality(conkey) AS cols
       FROM pg_constraint WHERE connamespace = 'hr'::regnamespace AND contype = 'f' AND conrelid = ${inMine} ORDER BY conname`,
    );
    const got = Object.fromEntries(rows.map((r) => [r.conname, `${r.cols}:${r.del}${r.upd}`]));
    // action codes: a=NO ACTION r=RESTRICT c=CASCADE n=SET NULL
    expect(got).toEqual({
      company_memberships_companyId_employeeId_fkey: '2:rr',
      company_memberships_companyId_fkey: '1:rc',
      company_memberships_companyId_roleId_fkey: '2:rr',
      company_memberships_userId_fkey: '1:rc',
      departments_companyId_fkey: '1:rc',
      employees_companyId_departmentId_fkey: '2:rr',
      employees_companyId_designationId_fkey: '2:rr',
      employees_companyId_fkey: '1:rc',
      employees_companyId_managerId_fkey: '2:rr',
      role_permissions_companyId_fkey: '1:rc',
      role_permissions_companyId_roleId_fkey: '2:cr',
      roles_companyId_fkey: '1:rc',
    });
  });

  it('has exactly the reviewed secondary indexes (21) and no extras', async () => {
    const rows = await q<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'hr' AND tablename = ANY($1) AND indexname NOT LIKE '%\\_pkey' ESCAPE '\\' ORDER BY indexname`,
      [MINE],
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'company_memberships_companyId_employeeId_key',
      'company_memberships_companyId_roleId_idx',
      'company_memberships_companyId_userId_key',
      'company_memberships_userId_idx',
      'departments_companyId_id_key',
      'departments_companyId_lower_name_key',
      'departments_companyId_name_key',
      'employees_companyId_departmentId_idx',
      'employees_companyId_designationId_idx',
      'employees_companyId_employeeNumber_key',
      'employees_companyId_id_key',
      'employees_companyId_lastName_firstName_idx',
      'employees_companyId_managerId_idx',
      'employees_companyId_status_idx',
      'employees_companyId_workEmail_key',
      'role_permissions_companyId_roleId_permission_key',
      'roles_companyId_id_key',
      'roles_companyId_key_key',
      'users_email_idx',
      'users_email_key',
      'users_externalId_key',
    ]);
  });

  it('companies has the init columns plus the phase-1 settings columns and only the three settings CHECKs', async () => {
    const cols = await q<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='hr' AND table_name='companies' ORDER BY ordinal_position`,
    );
    expect(cols.map((c) => c.column_name)).toEqual([
      'id', 'name', 'createdAt', 'updatedAt',
      'logoUrl', 'timezone', 'workingDays', 'workStartTime', 'workEndTime',
    ]);
    const own = await q<{ contype: string; conname: string }>(
      `SELECT contype, conname FROM pg_constraint WHERE conrelid = 'hr.companies'::regclass AND contype IN ('c','f','u') ORDER BY conname`,
    );
    expect(own.map((c) => [c.contype, c.conname])).toEqual([
      ['c', 'companies_timezone_not_blank'],
      ['c', 'companies_working_days_valid'],
      ['c', 'companies_working_hours_valid'],
    ]);
  });
});

describe('companies settings CHECK behaviour', () => {
  const setDays = (days: string) => admin.query(`UPDATE hr.companies SET "workingDays" = ${days} WHERE id = 'c1'`);
  const rejected = async (fn: () => Promise<unknown>, constraint: string) => {
    const e = await failure(fn);
    expect([e.code, e.constraint]).toEqual(['23514', constraint]);
  };

  it('workingDays: 1-7 distinct day numbers only', async () => {
    for (const bad of ["'{}'::int[]", "ARRAY[0]", "ARRAY[8]", "ARRAY[1,1]", "ARRAY[1,NULL]::int[]", "ARRAY[1,2,3,4,5,6,7,7]"]) {
      await rejected(() => setDays(bad), 'companies_working_days_valid');
    }
    for (const good of ['ARRAY[1]', 'ARRAY[1,2,3,4,5]', 'ARRAY[7,1,3]', 'ARRAY[1,2,3,4,5,6,7]']) {
      await expect(setDays(good)).resolves.toBeDefined();
    }
  });

  it('working hours must be HH:MM with start before end; timezone must not be blank', async () => {
    const set = (start: string, end: string) =>
      admin.query(`UPDATE hr.companies SET "workStartTime" = $1, "workEndTime" = $2 WHERE id = 'c1'`, [start, end]);
    for (const [s, e] of [['9:00', '17:00'], ['09:00', '24:00'], ['17:00', '09:00'], ['09:00', '09:00']]) {
      await rejected(() => set(s!, e!), 'companies_working_hours_valid');
    }
    await expect(set('08:30', '16:45')).resolves.toBeDefined();
    await rejected(() => admin.query(`UPDATE hr.companies SET timezone = '  ' WHERE id = 'c1'`), 'companies_timezone_not_blank');
  });
});

describe('CHECK constraint behaviour (as the runtime role hr_app)', () => {
  const emp = (extra: string, values: unknown[] = []) =>
    app.query(
      `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","updatedAt"${extra.split('|')[0]}) VALUES ('E','c1','E','a','b',now()${extra.split('|')[1] ?? ''})`,
      values,
    );
  const rejected = async (fn: () => Promise<unknown>, constraint: string) => {
    const e = await failure(fn);
    expect([e.code, e.constraint]).toEqual(['23514', constraint]);
  };

  it('users.email must be trimmed, lower-case and non-blank', async () => {
    const ins = (email: string) =>
      app.query(
        `INSERT INTO hr.users (id,"externalId",email,"updatedAt") VALUES (gen_random_uuid()::text, gen_random_uuid()::text, $1, now())`,
        [email],
      );
    for (const bad of ['Jane@Example.com', ' jane@example.com', 'jane@example.com ', '', '   ']) {
      await rejected(() => ins(bad), 'users_email_normalized');
    }
    await expect(ins('jane@example.com')).resolves.toBeDefined();
  });

  it('employees.workEmail must be trimmed, lower-case and non-blank when present (NULL allowed)', async () => {
    for (const bad of ['Jane@Example.com', ' jane@example.com', '']) {
      await rejected(() => emp(',"workEmail"|,$1', [bad]), 'employees_work_email_normalized');
    }
    await expect(emp(',"workEmail"|,$1', ['jane@example.com'])).resolves.toBeDefined();
    await admin.query('DELETE FROM hr.employees');
    await expect(emp('|')).resolves.toBeDefined(); // NULL workEmail
  });

  it('terminationDate may not precede hireDate', async () => {
    await rejected(
      () => emp(',"hireDate","terminationDate"|,$1,$2', ['2024-06-01', '2024-05-31']),
      'employees_termination_after_hire',
    );
    await expect(
      emp(',"hireDate","terminationDate"|,$1,$2', ['2024-06-01', '2024-06-01']),
    ).resolves.toBeDefined(); // same day ok
  });

  it('TERMINATED requires a terminationDate; other statuses may carry one', async () => {
    await rejected(
      () => emp(",status|,'TERMINATED'"),
      'employees_terminated_requires_termination_date',
    );
    await expect(
      emp(',status,"terminationDate"|,\'TERMINATED\',$1', ['2025-01-31']),
    ).resolves.toBeDefined();
    await admin.query('DELETE FROM hr.employees');
    await expect(
      emp(',status,"terminationDate"|,\'ACTIVE\',$1', ['2030-01-01']),
    ).resolves.toBeDefined(); // future-dated exit
    await admin.query("UPDATE hr.employees SET status = 'ONBOARDING'");
    // moving an existing employee to TERMINATED without a date is rejected on UPDATE too
    await admin.query('UPDATE hr.employees SET "terminationDate" = NULL');
    await rejected(
      () => app.query(`UPDATE hr.employees SET status = 'TERMINATED' WHERE id = 'E'`),
      'employees_terminated_requires_termination_date',
    );
  });

  it('no employee can be their own manager', async () => {
    await rejected(() => emp(',"managerId"|,\'E\''), 'employees_no_self_manager');
  });
});

describe('least privilege for hr_app', () => {
  it('has DML on every table, but no TRUNCATE and no CREATE on schema hr', async () => {
    const tables = [
      'companies',
      'users',
      'roles',
      'role_permissions',
      'departments',
      'company_memberships',
      'employees',
    ];
    for (const t of tables) {
      const [row] = await q<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege('hr_app', 'hr.${t}', 'SELECT,INSERT,UPDATE,DELETE') AS dml, has_table_privilege('hr_app', 'hr.${t}', 'TRUNCATE') AS truncate`,
      );
      expect([t, row!.dml, row!.truncate]).toEqual([t, true, false]);
    }
    const [s] = await q<{ create: boolean; usage: boolean }>(
      `SELECT has_schema_privilege('hr_app','hr','CREATE') AS "create", has_schema_privilege('hr_app','hr','USAGE') AS usage`,
    );
    expect(s).toEqual({ create: false, usage: true });
  });
});
