/**
 * Disposable database for the browser tests. It touches ONLY the scratch database `hr_itest_e2e`
 * (`assertScratchDb` allows nothing but `hr_itest*`; hr_db, hr_test and hosted databases are refused, and the
 * host must be local). Runs as hr_migrator on localhost. Prints no credentials.
 *
 *   tsx scripts/e2e-scratch-db.ts create        CREATE DATABASE if missing, rebuild schema hr from the migrations, seed
 *   tsx scripts/e2e-scratch-db.ts reset         truncate and seed again (fast; same ids and credentials)
 *   tsx scripts/e2e-scratch-db.ts drop          DROP DATABASE hr_itest_e2e
 *   tsx scripts/e2e-scratch-db.ts query "<sql>" run one statement, print the rows as JSON
 *   tsx scripts/e2e-scratch-db.ts urls          print DATABASE_URL and DIRECT_URL of the scratch database (for the API server)
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { parseDatabaseUrl } from '../src/database/connection-url';
import { hashPassword } from '../src/modules/auth/password';
import { assertScratchDb, maintenanceUrl, testUrl } from '../src/test/integration/helpers';

export const E2E_DB = 'hr_itest_e2e';
export const PASSWORD = 'E2e-Scratch-Pass-1!';
assertScratchDb(E2E_DB);

const migrationsDir = path.resolve(import.meta.dirname, '../src/database/migrations');
const directUrl = () => parseDatabaseUrl(testUrl('TEST_DIRECT_URL', E2E_DB)).connectionString;

async function withClient<T>(connectionString: string, fn: (c: pg.Client) => Promise<T>, expectDb?: string): Promise<T> {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    if (expectDb) {
      const { rows } = await c.query<{ db: string }>('select current_database() as db');
      if (rows[0]?.db !== expectDb) throw new Error(`SAFEGUARD: connected to "${rows[0]?.db}", expected "${expectDb}"`);
    }
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function createDatabase() {
  await withClient(maintenanceUrl(), async (m) => {
    const exists = ((await m.query('select 1 from pg_database where datname = $1', [E2E_DB])).rowCount ?? 0) > 0;
    if (!exists) await m.query(`CREATE DATABASE "${E2E_DB}"`);
  });
  await withClient(
    directUrl(),
    async (c) => {
      await c.query('DROP SCHEMA IF EXISTS hr CASCADE');
      await c.query('CREATE SCHEMA hr AUTHORIZATION hr_migrator');
      await c.query('GRANT USAGE ON SCHEMA hr TO hr_app');
      await c.query('ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app');
      await c.query('ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr GRANT USAGE, SELECT ON SEQUENCES TO hr_app');
      await c.query('SET search_path = hr');
      const names = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
      for (const name of names) await c.query(readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
    },
    E2E_DB,
  );
}

/** Two companies, the four roles in each, one person per role, a leave type and a department. Company A works every weekday. */
async function seed(c: pg.Client) {
  await c.query('TRUNCATE hr.company_memberships, hr.employees, hr.departments, hr.role_permissions, hr.roles, hr.users, hr.companies CASCADE');
  const A = randomUUID();
  const B = randomUUID();
  // All seven days are working days so check-in works whenever the suite runs; time zone is a real one on purpose.
  await c.query(`INSERT INTO hr.companies (id,name,timezone,"workingDays","workStartTime","workEndTime","updatedAt") VALUES ($1,'Acme','Asia/Kolkata','{1,2,3,4,5,6,7}','00:00','23:59',now())`, [A]);
  await c.query(`INSERT INTO hr.companies (id,name,timezone,"updatedAt") VALUES ($1,'Other Co','UTC',now())`, [B]);
  const roles: Record<string, string> = {};
  for (const company of [A, B])
    for (const key of ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']) {
      const rid = randomUUID();
      roles[`${company}:${key}`] = rid;
      await c.query(`INSERT INTO hr.roles (id,"companyId",key,name,"isSystem","updatedAt") VALUES ($1,$2,$3,$3,true,now())`, [rid, company, key]);
    }
  const dept = randomUUID();
  await c.query(`INSERT INTO hr.departments (id,"companyId",name,"updatedAt") VALUES ($1,$2,'Engineering',now())`, [dept, A]);
  const hash = hashPassword(PASSWORD);
  const people: Record<string, { user: string; emp: string }> = {};
  async function person(company: string, key: string, role: string, manager?: string, first = key, last = 'E2E') {
    const user = randomUUID();
    const emp = randomUUID();
    await c.query(`INSERT INTO hr.users (id,"externalId",email,name,"passwordHash","updatedAt") VALUES ($1,$1,$2,$3,$4,now())`, [user, `${key}@e2e.local`, `${first} ${last}`, hash]);
    await c.query(
      `INSERT INTO hr.employees (id,"companyId","employeeNumber","firstName","lastName","managerId","departmentId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',now())`,
      [emp, company, `E-${key}`, first, last, manager ? people[manager]!.emp : null, company === A ? dept : null],
    );
    await c.query(`INSERT INTO hr.company_memberships (id,"companyId","userId","roleId","employeeId",status,"updatedAt") VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`, [randomUUID(), company, user, roles[`${company}:${role}`], emp]);
    people[key] = { user, emp };
  }
  await person(A, 'sa', 'SUPER_ADMIN', undefined, 'Sasha', 'Admin');
  await person(A, 'hr', 'HR_ADMIN', 'sa', 'Hana', 'Admin');
  await person(A, 'mgr', 'MANAGER', 'sa', 'Mia', 'Manager');
  await person(A, 'team', 'EMPLOYEE', 'mgr', 'Ravi', 'Reddy');
  await person(A, 'peer', 'EMPLOYEE', 'sa', 'Pia', 'Peer');
  await person(B, 'hrb', 'HR_ADMIN', undefined, 'Hugo', 'Otherco');
  await person(B, 'empb', 'EMPLOYEE', undefined, 'Eve', 'Otherco');
  await c.query(`INSERT INTO hr.leave_types (id,"companyId",name,"annualAllocation","isPaid","allowHalfDay","isActive","updatedAt") VALUES ($1,$2,'Casual Leave',12,true,true,true,now())`, [randomUUID(), A]);
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'create':
    await createDatabase();
    await withClient(directUrl(), seed, E2E_DB);
    console.log(`created ${E2E_DB}`);
    break;
  case 'reset':
    await withClient(directUrl(), seed, E2E_DB);
    console.log('reset');
    break;
  case 'drop': {
    // The API server may still hold hr_app connections (hr_migrator may not terminate them, so no FORCE):
    // retry for a while, then leave the scratch database for the next `create`, which rebuilds it from scratch.
    assertScratchDb(E2E_DB);
    let dropped = false;
    for (let i = 0; i < 8 && !dropped; i += 1) {
      try {
        await withClient(maintenanceUrl(), (m) => m.query(`DROP DATABASE IF EXISTS "${E2E_DB}"`));
        dropped = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    console.log(dropped ? `dropped ${E2E_DB}` : `${E2E_DB} still in use; left in place (rebuilt by the next create)`);
    break;
  }
  case 'query':
    if (!arg) throw new Error('query needs a statement');
    console.log(JSON.stringify(await withClient(directUrl(), async (c) => (await c.query(arg)).rows, E2E_DB)));
    break;
  case 'urls':
    console.log(JSON.stringify({ DATABASE_URL: testUrl('TEST_DATABASE_URL', E2E_DB), DIRECT_URL: testUrl('TEST_DIRECT_URL', E2E_DB) }));
    break;
  default:
    throw new Error('usage: e2e-scratch-db.ts create|reset|drop|query <sql>|urls');
}
