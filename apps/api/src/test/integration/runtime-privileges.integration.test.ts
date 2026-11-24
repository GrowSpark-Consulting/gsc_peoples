import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './helpers';

/**
 * What the RUNTIME credential (hr_app, the only database role the Render service gets) can and cannot do, checked
 * against the real migrations on the scratch database. If a future migration widens these rights, this fails.
 */

let owner: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  owner = await connect('TEST_DIRECT_URL');
  app = await connect('TEST_DATABASE_URL');
});
afterAll(async () => {
  await owner?.end();
  await app?.end();
});

const tables = async () => (await owner.query<{ relname: string; rls: boolean }>(`select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hr' and c.relkind='r' and c.relname <> '_prisma_migrations' order by 1`)).rows;

/** Identity tables are read before a tenant is known (login, session lookup, invitation), so row-level security cannot apply to them. */
const IDENTITY_TABLES = ['company_memberships', 'invitation_tokens', 'password_reset_tokens', 'roles', 'user_sessions', 'users'];

describe('runtime role hr_app', () => {
  it('is an ordinary login role: no superuser, no createdb/createrole, no RLS bypass', async () => {
    const { rows } = await owner.query(`select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication from pg_roles where rolname='hr_app'`);
    expect(rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolreplication: false });
  });

  it('owns nothing in schema hr and cannot create objects (no DDL)', async () => {
    const owned = await owner.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hr' and pg_get_userbyid(c.relowner)='hr_app'`);
    expect(owned.rows).toEqual([]);
    expect((await owner.query(`select has_schema_privilege('hr_app','hr','CREATE') c, has_schema_privilege('hr_app','hr','USAGE') u`)).rows[0]).toEqual({ c: false, u: true });
    await expect(app.query('CREATE TABLE hr.should_not_exist (id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('DROP TABLE hr.employees')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('ALTER TABLE hr.employees ADD COLUMN x int')).rejects.toMatchObject({ code: '42501' });
  });

  it('has no TRUNCATE, REFERENCES or TRIGGER right on any table', async () => {
    for (const { relname } of await tables()) {
      for (const priv of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const r = await owner.query(`select has_table_privilege('hr_app', $1, $2) as ok`, [`hr.${relname}`, priv]);
        expect(r.rows[0].ok, `${priv} on ${relname}`).toBe(false);
      }
    }
  });

  it('cannot alter or delete audit history (audit_logs, employee_audit_logs are append-only)', async () => {
    for (const t of ['audit_logs', 'employee_audit_logs']) {
      for (const priv of ['UPDATE', 'DELETE']) {
        expect((await owner.query(`select has_table_privilege('hr_app', $1, $2) as ok`, [`hr.${t}`, priv])).rows[0].ok, `${priv} on ${t}`).toBe(false);
      }
      expect((await owner.query(`select has_table_privilege('hr_app', $1, 'INSERT') as ok`, [`hr.${t}`])).rows[0].ok).toBe(true);
    }
  });

  it('every tenant table has row-level security; only the identity tables do not', async () => {
    const all = await tables();
    expect(all.filter((t) => !t.rls).map((t) => t.relname).sort()).toEqual(IDENTITY_TABLES);
    expect(all.filter((t) => t.rls).length).toBeGreaterThanOrEqual(18);
  });

  it('cannot create or remove companies (no INSERT/DELETE policy on companies)', async () => {
    await app.query("SELECT set_config('app.company_id','00000000-0000-4000-8000-000000000001', false)");
    await expect(app.query(`INSERT INTO hr.companies (id,name,"updatedAt") VALUES ('00000000-0000-4000-8000-000000000001','x',now())`)).rejects.toMatchObject({ code: '42501' });
  });

  it('FINDING: default privileges would let hr_app write the migration history; the documented REVOKE removes it', async () => {
    // `prisma migrate deploy` creates hr._prisma_migrations as hr_migrator, so the default privileges apply to it.
    // The scratch database applies the SQL directly and has no such table, so create one the same way, in a
    // transaction that is rolled back.
    await owner.query('BEGIN');
    try {
      await owner.query('CREATE TABLE hr._prisma_migrations (id varchar PRIMARY KEY, migration_name varchar)');
      const can = async (priv: string) => (await owner.query(`select has_table_privilege('hr_app','hr._prisma_migrations',$1) as ok`, [priv])).rows[0].ok as boolean;
      expect(await can('INSERT')).toBe(true); // the default privileges grant DML: this is what must be revoked
      expect(await can('DELETE')).toBe(true);
      await owner.query('REVOKE ALL ON hr._prisma_migrations FROM hr_app'); // step in docs/deployment/supabase-production-migration.md
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await can(priv), priv).toBe(false);
    } finally {
      await owner.query('ROLLBACK');
    }
  });
});
