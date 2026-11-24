# Environment Variables

Single `.env` at the repository root (copy from `.env.example`, or let `pnpm db:setup` create it;
never commit it). The API and the Prisma CLI both read it. Real environment variables take precedence.

| Variable              | Required       | Default                        | Description                                                           |
| --------------------- | -------------- | ------------------------------ | --------------------------------------------------------------------- |
| `DATABASE_URL`        | **yes**        | -                              | Runtime URL, role `hr_app`, `?schema=hr`. Used by the API             |
| `DIRECT_URL`          | for migrations | falls back to `DATABASE_URL`   | Role `hr_migrator`. Used by the Prisma CLI only                       |
| `REDIS_URL`           | no             | -                              | Empty disables BullMQ / outbound events                               |
| `REDIS_PORT`          | no             | `6379`                         | Host port of the optional Redis container                             |
| `NODE_ENV`            | no             | `development`                  | `development` / `test` / `production`                                 |
| `API_PORT`            | no             | `4000`                         | API port                                                              |
| `LOG_LEVEL`           | no             | `info`                         | pino level                                                            |
| `CORS_ORIGINS`        | no             | `http://localhost:3000`        | Comma-separated allowed origins                                       |
| `AUTH_MODE`           | no             | `development`                  | `development` or `sso`; development is refused in production          |
| `CENTRAL_AUTH_*`      | later          | -                              | Pending platform contract                                             |
| `DEV_AUTH_COMPANY_ID` | no             | `dev-company`                  | Company used by the dev auth adapter                                  |
| `DEV_AUTH_ENABLED`    | no             | `false`                        | Explicit opt-in for the dev token adapter; also needs `NODE_ENV=development`. Refused in production |
| `NEXT_PUBLIC_API_URL` | no             | `http://localhost:4000/api/v1` | API base URL for the browser (export it or use `apps/web/.env.local`) |

## Local database (native PostgreSQL 18, no Docker)

GSC Peoples uses the existing PostgreSQL 18 Windows service on `localhost:5432`. The service is
never restarted or reconfigured, and no other database or role is touched.

| Item          | Value                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database      | `hr_db` (owner `hr_migrator`)                                                                                                                                             |
| Schema        | `hr` (HR tables and `hr._prisma_migrations` live here; `public` is not used)                                                                                              |
| `hr_app`      | Runtime. Login, no superuser/createdb. `USAGE` on `hr`, `SELECT/INSERT/UPDATE/DELETE` on tables and sequence use, via default privileges on objects `hr_migrator` creates |
| `hr_migrator` | Migrations. Owns `hr_db` and schema `hr`; has `CREATEDB` only so `prisma migrate dev` can create its temporary shadow database                                            |

### One-time setup

```bash
pnpm db:setup        # prompts for the PostgreSQL admin ("postgres") password; nothing is stored
pnpm db:generate
pnpm db:migrate      # first run creates the initial migration (Company table)
pnpm dev:api         # then open http://localhost:4000/api/v1/health -> database: "up"
```

`pnpm db:setup` (see `scripts/db/`) is idempotent: it creates `hr_app`, `hr_migrator`, `hr_db` and the
`hr` schema if missing, generates random passwords, and writes `DATABASE_URL` / `DIRECT_URL` into
`.env`. Re-running keeps existing credentials; use `pnpm db:setup -- -ResetPasswords` to rotate them.
`psql` is found automatically under `C:\Program Files\PostgreSQL\*\bin`.

Migrations are plain Prisma migrations in `apps/api/src/database/migrations`. Do not use
`prisma db push`. Use `pnpm db:migrate:deploy` (in `apps/api`) to apply existing migrations without
creating new ones.

## Redis

Run natively if you have it; otherwise `pnpm redis:up` starts only the Redis container
(`docker-compose.yml` no longer contains PostgreSQL). Then set `REDIS_URL=redis://localhost:6379`.
With `REDIS_URL` empty the API runs with background jobs disabled.

## Later: shared Supabase instance (not decided)

Only `DATABASE_URL` / `DIRECT_URL` would change; schema, migrations and repositories stay as they are.
Requires team approval. Nothing here creates shared Project/Sales/Platform schemas.

## Troubleshooting

- `Invalid environment configuration` on API start: `DATABASE_URL` is missing.
- Health `database: down`: PostgreSQL service stopped, or wrong credentials in `.env`.
- Health `redis: not_configured`: expected when `REDIS_URL` is empty.

## Development authentication and live API mode (local only)

- API: the dev adapter (`dev:<externalId>`, exactly two segments, only the three provisioned ids) is built only
  when `NODE_ENV=development` **and** `DEV_AUTH_ENABLED=true`. Any other non-production setting fails closed (no
  token accepted); production refuses to start with it. Roles/permissions/company are never read from the token:
  they come from the database membership (`/me`, `resolveTenant`).
- Web: `/api/dev-session` (server route) returns a token for one of three persona keys (`hr`, `manager`,
  `employee`) and is a 404 unless `NODE_ENV=development` and server-only `DEV_AUTH_ENABLED=true`.
  The directory uses the live API only with `NEXT_PUBLIC_EMPLOYEES_ADAPTER=http` and `NEXT_PUBLIC_DEV_AUTH=true`
  (development builds only). Production is always `http` and shows the "not available" notice; it never shows demo data.
- Live browser tests: `pnpm --filter @gsc/web test:e2e:live` (config `apps/web/playwright.live.config.ts`) starts
  its own API (port 4100) and web (port 3100) against local `hr_db`. Test employees are cleaned up by terminating
  them (audit history is append-only); the foreign-company fixture is removed outright.
- If Playwright's expected Chromium is not installed, set `PW_CHROMIUM_EXECUTABLE` to an installed Chromium.
