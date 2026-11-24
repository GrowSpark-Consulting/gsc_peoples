# Architecture Overview

## Place in the platform

```
BUSINESS PLATFORM
  Central Authentication / SSO
    ├── Project App ── project_db
    ├── HR App (this repo) ── hr_db
    └── Sales App ── sales_db
  Integration layer: REST APIs, Redis + BullMQ, domain events
```

This repository is the **HR app**: a Next.js frontend, an Express API and its own PostgreSQL
database (`hr_db`). It shares no database with other apps; cross-app data moves over REST or
domain events.

## Repository structure

| Path                 | Responsibility                                               |
| -------------------- | ------------------------------------------------------------ |
| `apps/web`           | Next.js App Router UI, feature modules under `src/modules/*` |
| `apps/api`           | Express API, Prisma, BullMQ                                  |
| `packages/contracts` | Zod schemas/types shared by web, API and (later) other apps  |
| `packages/shared`    | Generic utilities and validation helpers                     |
| `packages/config`    | tsconfig and ESLint presets only                             |

Workspace packages are consumed as TypeScript source (no build step): Next uses
`transpilePackages`; the API bundles them with tsup (`noExternal: [/^@gsc\//]`).
`contracts` and `shared` depend only on `zod`; neither depends on the other.

## API (`apps/api/src`)

- `app.ts` builds the Express app (`createApp`); `server.ts` starts it and handles graceful shutdown
  (HTTP server -> workers -> queues -> Redis -> Prisma).
- All routes live under `/api/v1`. Public routes (health) are mounted **before** the
  `authenticate` gate; every feature router must be mounted **after** it.
- Errors: throw `AppError` subclasses (`shared/errors`); `middleware/error` turns them into
  `{ error: { code, message, details?, requestId } }`.
- Validation: `validate({ body, query, params })` with Zod.
- Env: `config/env.ts` validates on boot and fails fast with a readable message.

### Feature module convention (not implemented yet)

```
modules/<name>/
  <name>.routes.ts  .controller.ts  .service.ts  .repository.ts  .schema.ts  .types.ts  .test.ts
```

Routes -> controller (HTTP only) -> service (rules) -> repository (Prisma). `modules/health` shows
the pattern; employees, departments, attendance, leave, onboarding, documents and dashboard are
empty folders awaiting their tasks.

## Authentication

The HR app does **not** own authentication. `integrations/central-auth` defines the
`CentralAuthProvider` interface (verify token, extract identity, resolve roles/permissions, sync user).

| `AUTH_MODE`   | Provider          | Notes                                                                                                                              |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `development` | `DevAuthProvider` | Local only. Token `dev:<userId>[:<role,role>]`, no cryptography. Rejected when `NODE_ENV=production` (env validation and factory). |
| `sso`         | `SsoProvider`     | **Fails closed** (rejects every token) until the platform contract exists.                                                         |

Token format, JWKS/issuer, claim names and role mapping are unknown and intentionally not guessed.

## Multi-company data ownership

`Company` is the tenancy root in `hr_db`. Rule for all future tables: a non-null `companyId`,
and every repository query filters by `req.user.companyId`. Only `Company` exists in the schema today.

## Background jobs and events

- `queues/`: shared ioredis connection, queue factory, retry defaults (5 attempts, exponential
  backoff, failed jobs retained 7 days), worker registry with failure logging, producer helper.
- `events/`: `EventPublisher` (BullMQ-backed, or no-op that logs drops), `EventConsumerRegistry`,
  envelope contract in `@gsc/contracts` (`DomainEventMap` is empty until events are agreed).
- `integrations/external/http-client.ts`: REST client with timeout and retry on 5xx/network errors.
- **Without `REDIS_URL`:** API runs normally; queues, workers and outbound events are disabled
  (publishing logs a warning; `enqueue` throws 503).

## Frontend design system

Strict monochrome tokens in `apps/web/src/app/globals.css` (`--gsc-*`), mapped onto shadcn/ui
variable names so generated components inherit them. Palette: `#090909`, `#FFFFFF`, `#F5F5F5`,
`#FAFAFA`, `#171717`, `#737373`, `#A3A3A3`, `#E5E5E5`, `#262626`. System font stack
(no network font fetch at build). shadcn is configured via `components.json`; add components with
`pnpm dlx shadcn@latest add <component>` from `apps/web`.

## Pinned decisions

- Prisma **7.10.1** (npm `latest` is an 8.0 release candidate).
- TypeScript **~5.9** (TS 7 is not yet supported by the lint/Next toolchain), ESLint 9.
- Prisma client is generated to `apps/api/src/database/generated` (git-ignored; run `pnpm db:generate`).
