/**
 * READ-ONLY Supabase catalog audit. Usage: DB_TARGET=supabase tsx scripts/supabase-audit.ts
 * Connects as hr_app (SUPABASE_DATABASE_URL) with verified TLS, runs one READ ONLY transaction of
 * catalog queries, prints no credentials and writes nothing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
const url = process.env.SUPABASE_DATABASE_URL;
const caPath = process.env.SUPABASE_CA_CERT_PATH;
if (!url || !caPath) throw new Error('SUPABASE_DATABASE_URL and SUPABASE_CA_CERT_PATH are required');

// Explicit fields (decoded) instead of re-serialising the URL: re-encoding can corrupt special characters.
const u = new URL(url);
const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  database: u.pathname.slice(1),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
});

const queries: Record<string, string> = {
  identity: `select current_user, session_user, current_schema(), current_setting('search_path') sp, version()`,
  roles: `select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin from pg_roles where rolname in ('hr_app','hr_migrator','postgres') order by 1`,
  schemas: `select nspname, pg_get_userbyid(nspowner) owner, nspacl::text acl from pg_namespace where nspname in ('hr','public','sales','project')`,
  default_privs: `select pg_get_userbyid(defaclrole) role, defaclobjtype, defaclacl::text from pg_default_acl`,
  extensions: `select extname, extversion from pg_extension order by 1`,
  tables: `select c.relname, pg_get_userbyid(c.relowner) owner, c.relrowsecurity rls, c.relforcerowsecurity forced, c.reltuples::bigint est_rows from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hr' and c.relkind='r' order by 1`,
  enums: `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='hr' group by 1 order by 1`,
  constraints: `select conrelid::regclass::text tbl, conname, contype from pg_constraint where connamespace='hr'::regnamespace order by 1,2`,
  indexes: `select tablename, indexname from pg_indexes where schemaname='hr' order by 1,2`,
  policies: `select tablename, policyname, cmd, roles::text from pg_policies where schemaname='hr' order by 1,2`,
  triggers: `select event_object_table, trigger_name from information_schema.triggers where trigger_schema='hr' order by 1,2`,
  functions: `select p.proname, pg_get_userbyid(p.proowner) owner from pg_proc p where pronamespace='hr'::regnamespace order by 1`,
  migrations: `select migration_name, finished_at, rolled_back_at from hr._prisma_migrations order by started_at`,
  hr_app_table_privs: `select table_name, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants where table_schema='hr' and grantee='hr_app' group by 1 order by 1`,
  hr_app_create_on_hr: `select has_schema_privilege('hr_app','hr','CREATE') can_create, has_schema_privilege('hr_app','hr','USAGE') can_use`,
  other_schema_access: `select nspname, has_schema_privilege('hr_app', nspname, 'USAGE') usage from pg_namespace where nspname in ('public','sales','project')`,
};

await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  for (const [name, sql] of Object.entries(queries)) {
    try {
      await client.query('SAVEPOINT q');
      const r = await client.query(sql);
      console.log(`\n## ${name} (${r.rowCount})`);
      console.table(r.rows);
      await client.query('RELEASE SAVEPOINT q');
    } catch (e) {
      console.log(`\n## ${name}: ERROR ${(e as Error).message}`);
      await client.query('ROLLBACK TO SAVEPOINT q');
    }
  }
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}
