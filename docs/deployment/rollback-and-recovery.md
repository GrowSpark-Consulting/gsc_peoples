# Rollback and recovery

All actions below that change hosted state need explicit approval [APPROVAL].

## 1. Application rollback (safe, no data change)

| Layer | Action |
|---|---|
| Web (Vercel) | Deployments → pick the last good deployment → *Promote to Production* (instant rollback, no rebuild). Note `NEXT_PUBLIC_API_URL` is baked into each build, so a rollback restores the API URL that build used |
| API (Render) | Events/Deploys → *Rollback* to the previous successful deploy, or redeploy a previous commit. Disable Auto-Deploy first if a bad commit keeps redeploying |
| Config only | Change env var → Render restarts. Wrong `CORS_ORIGINS`/`COOKIE_DOMAIN` symptoms: login succeeds but every request is 401, or the browser reports CORS errors |

Application rollbacks must stay schema-compatible: migrations are forward-only and additive (migration 7 adds enum values, which cannot be removed), so the previous API build keeps working against a newer schema only if it does not use removed objects; keep deploys small and in this order for a schema change: migrate → API → web.

## 2. Sessions

Rolling back or restarting never logs users out (sessions live in `hr.user_sessions`). To force sign-out of everyone: `UPDATE hr.user_sessions SET revoked_at = now() WHERE revoked_at IS NULL` as `hr_migrator` (column names to be verified against the schema first) [APPROVAL]. Password reset already revokes the user's sessions.

## 3. Database

- Migrations are **forward-only**; there is no down-migration.
- A migration that fails mid-way: stop; inspect `hr._prisma_migrations` (unfinished row) and the audit script; do not re-run blindly. Options, each separately approved: `prisma migrate resolve --rolled-back <name>` after manually confirming nothing partial remains; or, while the schema holds no real data, `DROP SCHEMA hr CASCADE`, recreate the schema and the Stage B grants exactly as documented in `docs/development/supabase-migration-plan.md`, then re-run the migrations.
- Once real data exists: restore from the latest verified `pg_dump -n hr` into a scratch Postgres 17 first, verify, then decide on a restore into Supabase. Prefer a forward fix over restore.
- Credential compromise: rotate the `hr_app` password in Supabase, update `SUPABASE_DATABASE_URL` in Render, restart; rotate `hr_migrator` separately (operator machine only).

## 4. Uploaded documents

If the interim Render disk is used, include the disk in recovery planning: Render disk snapshots are the only copy of files; database rows reference `storedPath`. Losing the disk orphans document rows. This is the main reason to move to object storage (blocker B3).

## 5. Decision log before first real data

- [ ] Backup capability of the Supabase plan confirmed.
- [ ] Restore rehearsal done.
- [ ] Owner of each secret (Render env, Vercel env, operator machine) named.
