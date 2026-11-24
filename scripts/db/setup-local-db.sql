-- Local development only. Idempotent. Run via scripts/db/setup-local-db.ps1 (pnpm db:setup).
-- Expects psql variables: migrator_pw, app_pw, reset ('true'|'false').
-- Touches only: roles hr_app / hr_migrator, database hr_db. Nothing else on the server.

\set ON_ERROR_STOP on

-- Roles (never superuser). hr_migrator may create databases ONLY so `prisma migrate dev`
-- can create its temporary shadow database.
SELECT format('CREATE ROLE hr_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE CREATEDB', :'migrator_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hr_migrator') \gexec

SELECT format('CREATE ROLE hr_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB', :'app_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hr_app') \gexec

\if :reset
  SELECT format('ALTER ROLE hr_migrator PASSWORD %L', :'migrator_pw') \gexec
  SELECT format('ALTER ROLE hr_app PASSWORD %L', :'app_pw') \gexec
\endif

-- Database owned by the migration role.
SELECT 'CREATE DATABASE hr_db OWNER hr_migrator'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hr_db') \gexec

REVOKE ALL ON DATABASE hr_db FROM PUBLIC;
GRANT CONNECT ON DATABASE hr_db TO hr_app, hr_migrator;

\connect hr_db

-- HR schema: owned by the migrator; the runtime role gets DML only.
CREATE SCHEMA IF NOT EXISTS hr AUTHORIZATION hr_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA hr TO hr_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT USAGE, SELECT ON SEQUENCES TO hr_app;

ALTER ROLE hr_app IN DATABASE hr_db SET search_path = hr;
ALTER ROLE hr_migrator IN DATABASE hr_db SET search_path = hr;
