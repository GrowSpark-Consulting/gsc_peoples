> **Superseded on 2026-11-25** by [production-migration-and-bootstrap.md](../development/production-migration-and-bootstrap.md). Kept for history; do not follow the steps below.

# Production bootstrap: plan (NOT IMPLEMENTED, NOT RUN)

Finding [CONFIRMED]: `apps/api/src/database/seeds/index.ts` and `scripts/provision-local.ts` create development personas and are local-only. **No production bootstrap exists**, so after migration nobody can sign in. This is blocker B1. Detailed design already agreed in `docs/development/production-bootstrap-plan.md`; this document adds the deployment-specific decisions.

## 1. Command

`apps/api/scripts/bootstrap-production.ts` + `apps/api/src/database/bootstrap/bootstrap.ts`, script `db:bootstrap`, wired into nothing (not dev/test/build/start). Run from the operator machine only, as **`hr_migrator`** (`SUPABASE_DIRECT_URL`, strict TLS): `hr_app` has no INSERT policy on `companies`/roles by design, and RLS must not be loosened.

Guards: requires `DB_TARGET=supabase`, `--confirm-company "<exact name>"`, all 7 migrations finished; `--dry-run` is the default and prints counts only; refuses if a company already exists unless it is the same one (single company per deployment, PRD A1); one transaction; every insert `ON CONFLICT DO NOTHING` on a natural key; second run reports `0 created`.

## 2. What it creates (all in schema `hr`)

Company (name, IANA timezone, working days, hours) · four system roles with `ROLE_DEFAULT_PERMISSIONS` (SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE, `isSystem`) · employee-number sequence (confirm `EMP-0001` vs local `EMP-001` first) · first employee (ACTIVE, no manager) · user · membership (SUPER_ADMIN) · departments/designations from config · leave types Casual/Sick/Earned with allowances from config · current-year leave balances for the first employee · onboarding template tasks from config · one `COMPANY_BOOTSTRAPPED` audit entry per group. No holidays, no demo data, no other employees.

Inputs come from a non-secret JSON config (company, timezone, hours, first Super Admin name + work email, leave allowances, onboarding items, departments). The PRD has not supplied these business values [MANUAL].

## 3. How the first Super Admin gets access (changes the earlier plan)

The earlier plan prompted the operator for the Super Admin password. **Do not do that**: the operator would know another person's password. Instead, using the existing invitation machinery [CONFIRMED in `auth.routes.ts`]:

1. Bootstrap creates the user **without a password hash** (login rejects users without one), the membership as `INVITED`, and one `invitation_tokens` row (hash only stored, 7-day expiry, single use).
2. The raw token is generated in memory and shown **once on the operator's terminal** as `https://app.<domain>/accept-invitation?token=<token>`; it is never logged, written to a file or stored in clear.
3. The operator hands the link to the Super Admin over a separate trusted channel (not the same chat/email thread as the web address if avoidable). Until SMTP exists (PRD A12; there is no email sender in the codebase) this manual hand-off is the only delivery path.
4. The Super Admin opens the link, chooses their own password (≥ 10 chars, scrypt-hashed server-side); the token is marked used, membership becomes ACTIVE, a session is created.
5. If the link expires: re-run bootstrap with `--reissue-invitation` (revokes old tokens, issues a new one), or use forgot-password once email exists.

No password, token, hash, e-mail or URL is printed to logs/CI; the run prints counts only plus the one-time link to the interactive terminal.

## 4. Verification after the (future, approved) run

1. Dry-run output equals expectation; second run `0 created`.
2. As `hr_app` with the new `app.company_id`: sees exactly the new company's rows; with no context: 0 rows.
3. Accept invitation in the browser → `/me` shows SUPER_ADMIN with company config.
4. Last-Super-Admin protection holds (cannot demote/disable the only one).
5. Cross-tenant check: a second (scratch) company id sees nothing of the first.

## 5. Tests to add with implementation (scratch Postgres 17 only)

Empty-DB bootstrap row counts; idempotent re-run; dry-run writes nothing; refuses non-hosted/local target without the flag; invitation token verifies once only; end-to-end invitation → login → `/me`.

## 6. Open inputs [MANUAL]

Company details, first Super Admin name/work email, leave allowances, onboarding items, departments/designations, employee code format, and the invite-email sender decision.
