/**
 * Browser-test fixture for ACCESS-FAILURE scenarios. It touches `hr_test` ONLY (never hr_db):
 * the database name is checked from TEST_DIRECT_URL and again with current_database() after connecting.
 *
 *   tsx scripts/e2e-testdb.ts prepare                       reset hr_test data, then provision the 3 dev personas
 *   tsx scripts/e2e-testdb.ts suspend <externalId>          membership -> SUSPENDED
 *   tsx scripts/e2e-testdb.ts activate <externalId>         membership -> ACTIVE
 *   tsx scripts/e2e-testdb.ts remove-membership <externalId>
 *   tsx scripts/e2e-testdb.ts other-company <externalId>    give the user an ACTIVE membership in a DIFFERENT company
 *   tsx scripts/e2e-testdb.ts database                      prints current_database()
 *
 * Runs as hr_migrator on localhost. Prints no credentials.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { parseDatabaseUrl } from '../src/database/connection-url';
import { hashPassword } from '../src/modules/auth/password';
import {
  assertLocalTarget,
  defaultSpec,
  provisionLocal,
} from '../src/database/provisioning/local-provisioning';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const DEV_COMPANY = process.env.DEV_AUTH_COMPANY_ID ?? 'dev-company';
const OTHER_COMPANY = 'e2e-access-other';

async function main() {
  const [command, externalId] = process.argv.slice(2);
  const url = process.env.TEST_DIRECT_URL;
  if (!url) throw new Error('TEST_DIRECT_URL is not set (run pnpm db:test:setup)');
  const target = assertLocalTarget(url);
  if (target.database !== 'hr_test') throw new Error('SAFEGUARD: this fixture only runs against hr_test');

  const c = new pg.Client({ connectionString: parseDatabaseUrl(url).connectionString });
  await c.connect();
  try {
    const { rows } = await c.query<{ db: string }>('select current_database() as db');
    if (rows[0]?.db !== 'hr_test') throw new Error('SAFEGUARD: connected database is not hr_test');

    if (command === 'database') {
      console.log(rows[0].db);
    } else if (command === 'prepare') {
      await c.query(
        'TRUNCATE hr.user_sessions, hr.password_reset_tokens, hr.invitation_tokens, hr.company_memberships, hr.employees, hr.departments, hr.role_permissions, hr.roles, hr.users, hr.companies CASCADE',
      );
      const report = await provisionLocal(c, defaultSpec(DEV_COMPANY));
      console.log(JSON.stringify(report.created));
    } else if (command === 'suspend' || command === 'activate') {
      const status = command === 'suspend' ? 'SUSPENDED' : 'ACTIVE';
      const r = await c.query(
        `UPDATE hr.company_memberships m SET status = $2, "updatedAt" = now()
         FROM hr.users u WHERE u.id = m."userId" AND u."externalId" = $1 AND m."companyId" = $3`,
        [externalId, status, DEV_COMPANY],
      );
      if (r.rowCount !== 1) throw new Error(`expected to change exactly 1 membership, changed ${r.rowCount}`);
    } else if (command === 'remove-membership') {
      const r = await c.query(
        `DELETE FROM hr.company_memberships m USING hr.users u
         WHERE u.id = m."userId" AND u."externalId" = $1 AND m."companyId" = $2`,
        [externalId, DEV_COMPANY],
      );
      if (r.rowCount !== 1) throw new Error(`expected to remove exactly 1 membership, removed ${r.rowCount}`);
    } else if (command === 'other-company') {
      await c.query(
        `INSERT INTO hr.companies (id, name, "updatedAt") VALUES ($1, $1, now()) ON CONFLICT (id) DO NOTHING`,
        [OTHER_COMPANY],
      );
      const role = await c.query<{ id: string }>(
        `INSERT INTO hr.roles (id, "companyId", key, name, "isSystem", "updatedAt")
         VALUES ($1, $2, 'HR_ADMIN', 'HR Admin', true, now())
         ON CONFLICT ("companyId", key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [randomUUID(), OTHER_COMPANY],
      );
      const user = await c.query<{ id: string }>(`SELECT id FROM hr.users WHERE "externalId" = $1`, [externalId]);
      if (!user.rows[0]) throw new Error(`unknown user ${externalId}`);
      await c.query(
        `INSERT INTO hr.company_memberships (id, "companyId", "userId", "roleId", status, "updatedAt")
         VALUES ($1, $2, $3, $4, 'ACTIVE', now())`,
        [randomUUID(), OTHER_COMPANY, user.rows[0].id, role.rows[0]!.id],
      );
    } else if (command === 'set-passwords') {
      // Real login credentials for the three provisioned personas (hr_test only). The password is
      // supplied by the caller (the Playwright suite); only its scrypt hash is stored.
      const password = process.argv[3];
      if (!password || password.length < 10) throw new Error('usage: set-passwords <password of 10+ chars>');
      const r = await c.query(
        `UPDATE hr.users SET "passwordHash" = $1, status = 'ACTIVE', "updatedAt" = now() WHERE "externalId" = ANY($2)`,
        [hashPassword(password), ['dev-super-admin', 'dev-hr-admin', 'dev-manager', 'dev-employee']],
      );
      if (r.rowCount !== 4) throw new Error(`expected to set 4 passwords, set ${r.rowCount}`);
    } else if (command === 'revoke-sessions' || command === 'expire-sessions') {
      const sql =
        command === 'revoke-sessions'
          ? `UPDATE hr.user_sessions s SET "revokedAt" = now() FROM hr.users u WHERE u.id = s."userId" AND u."externalId" = $1`
          : `UPDATE hr.user_sessions s SET "lastActivityAt" = (now() at time zone 'utc') - interval '9 hours' FROM hr.users u WHERE u.id = s."userId" AND u."externalId" = $1`;
      const r = await c.query(sql, [externalId]);
      if (!r.rowCount) throw new Error(`no sessions found for ${externalId}`);
    } else if (command === 'promote-super-admin') {
      // hr_test only: gives a provisioned persona the SUPER_ADMIN role (needed to drive Settings routes).
      const r = await c.query(
        `UPDATE hr.company_memberships m SET "roleId" = ro.id, "updatedAt" = now()
         FROM hr.users u, hr.roles ro
         WHERE u.id = m."userId" AND u."externalId" = $1 AND m."companyId" = $2
           AND ro."companyId" = m."companyId" AND ro.key = 'SUPER_ADMIN'`,
        [externalId, DEV_COMPANY],
      );
      if (r.rowCount !== 1) throw new Error(`expected to promote exactly 1 membership, promoted ${r.rowCount}`);
    } else if (command === 'disable-user' || command === 'enable-user') {
      const r = await c.query(
        `UPDATE hr.users SET status = $2, "updatedAt" = now() WHERE "externalId" = $1`,
        [externalId, command === 'disable-user' ? 'DISABLED' : 'ACTIVE'],
      );
      if (r.rowCount !== 1) throw new Error(`expected to change exactly 1 user, changed ${r.rowCount}`);
    } else if (command === 'count') {
      // count <table> [where-less]: read-only evidence helper for browser tests (allow-listed tables).
      const table = externalId;
      if (!['employees', 'user_sessions', 'employee_audit_logs'].includes(table ?? '')) throw new Error('table not allowed');
      const { rows: counted } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM hr.${table}`);
      console.log(counted[0]?.n);
    } else if (command === 'employee-by-number') {
      // Prints status/jobTitle/department of one employee so the browser test can prove persistence.
      const { rows: found } = await c.query(
        `SELECT "employeeNumber", "firstName", "lastName", "jobTitle", status FROM hr.employees WHERE "employeeNumber" = $1`,
        [externalId],
      );
      console.log(JSON.stringify(found[0] ?? null));
    } else {
      throw new Error('usage: prepare|set-passwords|suspend|activate|remove-membership|other-company|revoke-sessions|expire-sessions|promote-super-admin|disable-user|enable-user|count|employee-by-number|database [arg]');
    }
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
