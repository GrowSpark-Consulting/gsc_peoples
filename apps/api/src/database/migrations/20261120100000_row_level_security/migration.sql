-- Row-Level Security (PRD section 5: "enforced ... again by Postgres Row Level Security on company_id").
-- Additive and non-destructive: no table, column or row is changed; only policies are added.
--
-- How it works
--   * The API sets the tenant for each unit of work with set_config('app.company_id', <id>, true)
--     (transaction-local), taken from the validated session membership, never from request input.
--   * Policies compare each row's company to current_company_id(). With NO tenant context (never set,
--     or reverted to '' after the transaction ended) the function returns NULL, every comparison is
--     NULL, and the runtime role sees and can change nothing: fail closed.
--   * The runtime role hr_app is NOSUPERUSER, NOBYPASSRLS and not the owner, so policies always apply
--     to it. hr_migrator owns the tables and is NOT forced: migrations, provisioning and test fixtures
--     (which run as the owner) are unaffected. Foreign-key checks run as the table owner and are
--     unaffected too; cross-company references stay blocked by the composite foreign keys.
--
-- Covered (company-scoped data the API reads/writes only inside a tenant context):
--   companies, employees, departments, holidays, role_permissions, employee_audit_logs, audit_logs.
-- Not covered here (authentication plane, read BEFORE a tenant is known: login, session and CSRF lookup,
--   invitation / reset tokens, membership and role lookup): company_memberships, roles, user_sessions,
--   password_reset_tokens, invitation_tokens. See the Slice 1 RLS report.

CREATE FUNCTION "current_company_id"() RETURNS TEXT
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.company_id', true), '') $$;

-- companies: a tenant can read and update only its own row. No INSERT/DELETE policy: the runtime role
-- cannot create or remove companies (company setup is a provisioning step).
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "companies_tenant_select" ON "companies" FOR SELECT
  USING ("id" = "current_company_id"());
CREATE POLICY "companies_tenant_update" ON "companies" FOR UPDATE
  USING ("id" = "current_company_id"())
  WITH CHECK ("id" = "current_company_id"());

-- Ordinary company-owned tables: every command, both for existing rows (USING) and new/changed rows (WITH CHECK).
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_tenant_isolation" ON "employees" FOR ALL
  USING ("companyId" = "current_company_id"())
  WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_tenant_isolation" ON "departments" FOR ALL
  USING ("companyId" = "current_company_id"())
  WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays_tenant_isolation" ON "holidays" FOR ALL
  USING ("companyId" = "current_company_id"())
  WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_tenant_isolation" ON "role_permissions" FOR ALL
  USING ("companyId" = "current_company_id"())
  WITH CHECK ("companyId" = "current_company_id"());

-- Append-only audit tables (PRD: "append-only; no update or delete policy"): SELECT and INSERT policies
-- only, so UPDATE and DELETE match no policy and are denied for the runtime role.
ALTER TABLE "employee_audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_audit_logs_tenant_select" ON "employee_audit_logs" FOR SELECT
  USING ("companyId" = "current_company_id"());
CREATE POLICY "employee_audit_logs_tenant_insert" ON "employee_audit_logs" FOR INSERT
  WITH CHECK ("companyId" = "current_company_id"());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_tenant_select" ON "audit_logs" FOR SELECT
  USING ("companyId" = "current_company_id"());
CREATE POLICY "audit_logs_tenant_insert" ON "audit_logs" FOR INSERT
  WITH CHECK ("companyId" = "current_company_id"());
