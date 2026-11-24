import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertScratchDb, bindTenant, connect, failure, maintenanceUrl, testUrl } from './helpers';
import { insertCompany, insertEmployee, insertUser, resetData } from './seed';

/**
 * 20261121130000_prd_p0_backend_modules, verified on real PostgreSQL:
 *   1. the PRD integrity rules it adds (constraints, partial unique index, overlap trigger);
 *   2. applied on top of a database that already holds data (data preserved, re-run safe).
 * Part 1 runs in the shared scratch database; part 2 builds and drops its own second scratch database.
 */
const MIGRATIONS = path.resolve(import.meta.dirname, '../../database/migrations');
const P0 = '20261121130000_prd_p0_backend_modules';
const migrationNames = () =>
  readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const sqlOf = (name: string) => readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8');

describe('PRD integrity rules added by the P0 migration', () => {
  let admin: pg.Client; // hr_migrator
  let app: pg.Client; // hr_app, bound to tenant c1

  beforeAll(async () => {
    admin = await connect('TEST_DIRECT_URL');
    app = await connect('TEST_DATABASE_URL');
    await bindTenant(app, 'c1');
  });
  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });
  beforeEach(async () => {
    await resetData(admin);
    await insertUser(admin, 'u1');
    for (const c of ['c1', 'c2']) {
      await insertCompany(admin, c);
      await insertEmployee(admin, { id: `e-${c}`, companyId: c });
      await insertEmployee(admin, { id: `e2-${c}`, companyId: c });
      await admin.query(`INSERT INTO hr.leave_types (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Casual',now())`, [`lt-${c}`, c]);
    }
  });

  const attendance = (id: string, inAt: string | null, outAt: string | null) =>
    app.query(
      `INSERT INTO hr.attendance_records (id,"companyId","employeeId",date,"checkInAt","checkOutAt","updatedAt")
       VALUES ($1,'c1','e-c1',DATE '2031-03-03' + (abs(hashtext($1)) % 3000),$2,$3,now())`,
      [id, inAt, outAt],
    );

  it('attendance: check-out must be later than check-in (ATT-001); open or partial records are fine', async () => {
    expect((await failure(() => attendance('a1', '2031-03-03 09:00', '2031-03-03 08:00'))).constraint).toBe('attendance_records_out_after_in');
    expect((await failure(() => attendance('a2', '2031-03-03 09:00', '2031-03-03 09:00'))).code).toBe('23514');
    await attendance('a3', '2031-03-03 09:00', '2031-03-03 17:30');
    await attendance('a4', '2031-03-03 09:00', null);
    await attendance('a5', null, null);
  });

  const correction = (id: string, date: string, status = 'PENDING', inAt = '2031-03-03 09:00', outAt = '2031-03-03 18:00', emp = 'e-c1') =>
    app.query(
      `INSERT INTO hr.attendance_corrections (id,"companyId","employeeId",date,"proposedCheckInAt","proposedCheckOutAt",reason,status,"updatedAt")
       VALUES ($1,'c1',$2,$3,$4,$5,'forgot',$6,now())`,
      [id, emp, date, inAt, outAt, status],
    );

  it('corrections: proposed out after in; at most one PENDING per employee and date (ATT-005)', async () => {
    expect((await failure(() => correction('k0', '2031-03-03', 'PENDING', '2031-03-03 18:00', '2031-03-03 09:00'))).constraint).toBe('attendance_corrections_out_after_in');
    await correction('k1', '2031-03-03');
    const dup = await failure(() => correction('k2', '2031-03-03'));
    expect([dup.code, dup.constraint]).toEqual(['23505', 'attendance_corrections_one_pending_key']); // partial unique index
    await correction('k3', '2031-03-04'); // another date
    await correction('k4', '2031-03-03', 'PENDING', undefined, undefined, 'e2-c1'); // another employee
    await admin.query(`UPDATE hr.attendance_corrections SET status='REJECTED' WHERE id='k1'`);
    await correction('k5', '2031-03-03'); // the earlier one is decided, a new request is allowed
    await correction('k6', '2031-03-03', 'APPROVED'); // decided rows never conflict
  });

  const leave = (c: pg.Client, id: string, start: string, end: string, status = 'PENDING', emp = 'e-c1', company = 'c1') =>
    c.query(
      `INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate",reason,days,status,"updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'r',1,$7,now())`,
      [id, company, emp, `lt-${company}`, start, end, status],
    );

  it('leave: overlapping Pending/Approved ranges are refused (23P01); adjacent, other employee, decided rows are fine', async () => {
    await leave(app, 'l1', '2031-05-10', '2031-05-12');
    const o1 = await failure(() => leave(app, 'l2', '2031-05-12', '2031-05-14'));
    expect([o1.code, o1.constraint]).toEqual(['23P01', 'leave_requests_no_overlap']);
    expect((await failure(() => leave(app, 'l3', '2031-05-09', '2031-05-10', 'APPROVED'))).code).toBe('23P01');
    expect((await failure(() => leave(app, 'l4', '2031-05-11', '2031-05-11'))).code).toBe('23P01'); // inside
    expect((await failure(() => leave(app, 'l5', '2031-05-01', '2031-05-31'))).code).toBe('23P01'); // surrounding
    await leave(app, 'l6', '2031-05-13', '2031-05-14'); // adjacent: allowed
    await leave(app, 'l7', '2031-05-10', '2031-05-12', 'PENDING', 'e2-c1'); // another employee
    await leave(app, 'l8', '2031-05-10', '2031-05-12', 'REJECTED'); // decided rows do not block
    await leave(app, 'l9', '2031-05-10', '2031-05-12', 'CANCELLED');
  });

  it('leave: re-opening a decided row into an overlap is refused; cancelling frees the dates', async () => {
    await leave(app, 'l1', '2031-06-10', '2031-06-12');
    await leave(app, 'l2', '2031-06-10', '2031-06-12', 'REJECTED');
    expect((await failure(() => app.query(`UPDATE hr.leave_requests SET status='PENDING' WHERE id='l2'`))).code).toBe('23P01');
    await app.query(`UPDATE hr.leave_requests SET status='CANCELLED' WHERE id='l1'`);
    await app.query(`UPDATE hr.leave_requests SET status='APPROVED' WHERE id='l2'`); // no longer overlapping anything live
    expect((await failure(() => leave(app, 'l3', '2031-06-11', '2031-06-11'))).code).toBe('23P01');
  });

  it('leave: two simultaneous overlapping applications - exactly one wins (advisory lock)', async () => {
    const c2 = await connect('TEST_DATABASE_URL');
    const c3 = await connect('TEST_DATABASE_URL');
    try {
      await bindTenant(c2, 'c1');
      await bindTenant(c3, 'c1');
      const results = await Promise.allSettled([
        leave(c2, 'r1', '2031-07-01', '2031-07-05'),
        leave(c3, 'r2', '2031-07-03', '2031-07-08'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as { code?: string }).code).toBe('23P01');
    } finally {
      await c2.end();
      await c3.end();
    }
  });

  it('leave: the overlap check never crosses companies', async () => {
    await leave(admin, 'x1', '2031-08-01', '2031-08-03', 'PENDING', 'e-c2', 'c2');
    await leave(app, 'x2', '2031-08-01', '2031-08-03'); // company c1, same dates: fine
  });

  it('leave: a half day is one date with a session; a full day has none (LEAVE-003)', async () => {
    const ins = (id: string, dayType: string, session: string | null, start: string, end: string) =>
      app.query(
        `INSERT INTO hr.leave_requests (id,"companyId","employeeId","leaveTypeId","startDate","endDate","dayType","halfDaySession",reason,days,"updatedAt")
         VALUES ($1,'c1','e-c1','lt-c1',$2,$3,$4::"hr"."LeaveDayType",$5::"hr"."LeaveHalfSession",'r',0.5,now())`,
        [id, start, end, dayType, session],
      );
    expect((await failure(() => ins('h1', 'HALF_DAY', null, '2031-09-01', '2031-09-01'))).constraint).toBe('leave_requests_half_day_valid');
    expect((await failure(() => ins('h2', 'HALF_DAY', 'FIRST_HALF', '2031-09-01', '2031-09-02'))).constraint).toBe('leave_requests_half_day_valid');
    expect((await failure(() => ins('h3', 'FULL_DAY', 'FIRST_HALF', '2031-09-03', '2031-09-03'))).constraint).toBe('leave_requests_half_day_valid');
    await ins('h4', 'HALF_DAY', 'SECOND_HALF', '2031-09-04', '2031-09-04');
    await ins('h5', 'FULL_DAY', null, '2031-09-10', '2031-09-12');
    expect((await failure(() => leave(app, 'h6', '2031-10-12', '2031-10-10'))).constraint).toBe('leave_requests_dates_valid');
  });

  it('documents: at most 10 MB (DOC-001) and an owner exactly when it is not a company document', async () => {
    const doc = (id: string, owner: string | null, company: boolean, size: number) =>
      app.query(
        `INSERT INTO hr.employee_documents (id,"companyId","ownerEmployeeId","isCompanyDocument","fileName","storedPath","mimeType","sizeBytes","updatedAt")
         VALUES ($1,'c1',$2,$3,'f','p','application/pdf',$4,now())`,
        [id, owner, company, size],
      );
    await doc('d1', 'e-c1', false, 10 * 1024 * 1024);
    expect((await failure(() => doc('d2', 'e-c1', false, 10 * 1024 * 1024 + 1))).constraint).toBe('employee_documents_size_max');
    expect((await failure(() => doc('d3', 'e-c1', false, 0))).constraint).toBe('employee_documents_size_positive');
    expect((await failure(() => doc('d4', null, false, 5))).constraint).toBe('employee_documents_owner_matches_flag');
    expect((await failure(() => doc('d5', 'e-c1', true, 5))).constraint).toBe('employee_documents_owner_matches_flag');
    await doc('d6', null, true, 5); // company policy document
  });

  it('holidays: the isActive column exists, defaults to true, and one holiday per date still holds', async () => {
    await app.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ('h1','c1','2031-01-26','Republic Day',now())`);
    expect((await app.query(`SELECT "isActive" FROM hr.holidays WHERE id='h1'`)).rows[0].isActive).toBe(true);
    expect((await failure(() => app.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ('h2','c1','2031-01-26','Again',now())`))).code).toBe('23505');
  });

  it('hr_app has row access (and nothing more) on the new tables', async () => {
    const tables = ['designations', 'employee_number_sequences', 'onboarding_template_tasks', 'onboarding_tasks', 'attendance_records', 'attendance_corrections', 'leave_types', 'leave_balances', 'leave_requests', 'employee_documents', 'notifications'];
    for (const t of tables) {
      const r = (await admin.query(
        `SELECT bool_and(has_table_privilege('hr_app', 'hr.' || $1, p)) AS dml,
                bool_or(has_table_privilege('hr_app', 'hr.' || $1, q)) AS extra
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p, unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) q`,
        [t],
      )).rows[0];
      // default privileges of the test setup may also grant REFERENCES/TRIGGER; TRUNCATE must never be there
      expect(r.dml, t).toBe(true);
      expect((await admin.query(`SELECT has_table_privilege('hr_app','hr.${t}','TRUNCATE') AS t`)).rows[0].t, `${t} TRUNCATE`).toBe(false);
    }
  });
});

describe('applying the P0 migration on a database that already holds data', () => {
  const DB = 'hr_itest_migr';
  let admin: pg.Client;

  const maintenance = async (sql: string) => {
    const c = new pg.Client({ connectionString: maintenanceUrl() });
    await c.connect();
    try {
      await c.query(sql);
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    assertScratchDb(DB);
    await maintenance(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await maintenance(`CREATE DATABASE "${DB}"`);
    const { parseDatabaseUrl } = await import('../../database/connection-url');
    admin = new pg.Client({ connectionString: parseDatabaseUrl(testUrl('TEST_DIRECT_URL', DB)).connectionString });
    await admin.connect();
    expect((await admin.query('select current_database() as d')).rows[0].d).toBe(DB);
    await admin.query('CREATE SCHEMA hr AUTHORIZATION hr_migrator');
    await admin.query('GRANT USAGE ON SCHEMA hr TO hr_app');
    await admin.query('ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app');
    await admin.query('SET search_path = hr');
  }, 120_000); // CREATE/DROP DATABASE force a checkpoint, slow right after a write-heavy run
  afterAll(async () => {
    await admin?.end();
    assertScratchDb(DB);
    await maintenance(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
  }, 120_000);

  it('keeps every existing row, leaves existing numbers untouched, continues numbering, and can be re-run', async () => {
    const before = migrationNames().filter((n) => n < P0);
    expect(before.length).toBeGreaterThanOrEqual(6); // everything up to and including row_level_security
    for (const n of before) await admin.query(sqlOf(n));

    // pre-existing data in the previous schema state, including legacy three-digit numbers
    await admin.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ('c1','Acme',now()), ('c2','Beta',now())`);
    for (const [id, c, num] of [['e1', 'c1', 'EMP-001'], ['e2', 'c1', 'EMP-012'], ['e3', 'c1', 'CONTRACTOR-9'], ['e4', 'c2', 'EMP-003']]) {
      await admin.query(
        `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","updatedAt") VALUES ($1,$2,$3,'F','L',now())`,
        [id, c, num],
      );
    }
    await admin.query(`INSERT INTO hr.holidays (id,"companyId",date,name,"updatedAt") VALUES ('h1','c1','2031-01-26','Republic Day',now())`);
    const snapshot = (await admin.query(`SELECT id,"employeeNumber","firstName" FROM hr.employees ORDER BY id`)).rows;

    await admin.query(sqlOf(P0)); // first application

    expect((await admin.query(`SELECT id,"employeeNumber","firstName" FROM hr.employees ORDER BY id`)).rows).toEqual(snapshot);
    const h = (await admin.query(`SELECT name, date::text AS date, "isActive" FROM hr.holidays WHERE id='h1'`)).rows;
    expect(h).toEqual([{ name: 'Republic Day', date: '2031-01-26', isActive: true }]);
    // the sequence continues after the highest EMP-<n> per company; the legacy numbers are not rewritten
    const seq = (await admin.query(`SELECT "companyId","nextValue" FROM hr.employee_number_sequences ORDER BY "companyId"`)).rows;
    expect(seq).toEqual([{ companyId: 'c1', nextValue: 13 }, { companyId: 'c2', nextValue: 4 }]);

    const rls = (await admin.query(
      `SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='hr'::regnamespace AND relkind='r' AND relrowsecurity`,
    )).rows[0].n;
    expect(rls).toBe(18);

    // applying it again must neither fail nor change anything
    await admin.query(sqlOf(P0));
    expect((await admin.query(`SELECT id,"employeeNumber","firstName" FROM hr.employees ORDER BY id`)).rows).toEqual(snapshot);
    expect((await admin.query(`SELECT "companyId","nextValue" FROM hr.employee_number_sequences ORDER BY "companyId"`)).rows).toEqual(seq);
    expect((await admin.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='hr'`)).rows[0].n).toBe(21);
  });
});
