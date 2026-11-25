import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Repo-level .env is the single source of configuration. Real env vars win.
loadEnv({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Render (and most PaaS) inject PORT; API_PORT stays the local override. Resolved in parseEnv. */
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Bind address. 0.0.0.0 is required inside containers/PaaS. */
    HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
    /** Number of reverse-proxy hops to trust for req.ip / secure detection (Render = 1). 0 disables. */
    TRUST_PROXY_HOPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(5).optional()),
    /** Optional cookie Domain (e.g. .example.com) so app.* and api.* share the session cookies. Host-only when unset. */
    COOKIE_DOMAIN: optionalString,
    /** Directory for uploaded documents (default ./storage/documents under the API working directory). */
    DOCUMENTS_STORAGE_DIR: optionalString,
    /**
     * Where document bytes live. `local` = disk under DOCUMENTS_STORAGE_DIR (development and tests only,
     * rejected in production). `supabase` = a PRIVATE Supabase Storage bucket reached server-side only.
     */
    DOCUMENT_STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['local', 'supabase']).default('local')),
    /** Storage API base, e.g. https://<project-ref>.supabase.co (required when DOCUMENT_STORAGE_DRIVER=supabase). */
    SUPABASE_STORAGE_URL: optionalUrl,
    /** Server-side service key. Never sent to the browser, never logged. Required for the supabase driver. */
    SUPABASE_STORAGE_SERVICE_KEY: optionalString,
    /** Private bucket name. The bucket must be created as non-public (see docs/development/next-sprint-report.md). */
    SUPABASE_STORAGE_BUCKET: z.preprocess(emptyToUndefined, z.string().min(3).max(63).default('hr-documents')),
    /** HMAC secret for the local driver's 60-second download links (development only; random per process when unset). */
    DOCUMENTS_LOCAL_SIGNING_SECRET: optionalString,
    /** Requests per minute and client IP for the whole API (the health check is exempt). Disabled when NODE_ENV=test. */
    RATE_LIMIT_PER_MINUTE: z.preprocess(emptyToUndefined, z.coerce.number().int().min(10).max(100_000).default(600)),
    /** Requests per 15 minutes and client IP for login, forgot/reset password and invitation acceptance. */
    AUTH_RATE_LIMIT_PER_15_MIN: z.preprocess(emptyToUndefined, z.coerce.number().int().min(5).max(100_000).default(30)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    /** Internal: true when CORS_ORIGINS was provided (the localhost default must not leak into production). */
    CORS_ORIGINS_EXPLICIT: z.boolean().default(false),
    DATABASE_URL: optionalString,
    /** Connections per API instance. Keep below the pooler's limit for the plan in use. */
    DATABASE_POOL_MAX: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(50).default(10)),
    /** Explicit database target. `local` (default) never reads any SUPABASE_* variable. */
    DB_TARGET: z.preprocess(emptyToUndefined, z.enum(['local', 'supabase']).default('local')),
    /** Runtime URL for the hr_app role through the Supabase Session Pooler (used only when DB_TARGET=supabase). */
    SUPABASE_DATABASE_URL: optionalString,
    /** Migration URL for hr_migrator (Prisma CLI only, never read by the running API). */
    SUPABASE_DIRECT_URL: optionalString,
    /** Path to the Supabase CA certificate; verified TLS is mandatory for the supabase target. */
    SUPABASE_CA_CERT_PATH: optionalString,
    REDIS_URL: optionalUrl,
    /**
     * Outbound email (invitations and password resets only). `smtp` sends through any SMTP provider.
     * `disabled` runs without email: invitations answer 503 and reset requests send nothing.
     * Production must choose explicitly, so a deployment can never silently drop invitation links.
     */
    MAIL_DRIVER: z.preprocess(emptyToUndefined, z.enum(['disabled', 'smtp']).optional()),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(587)),
    /** true = TLS from the first byte (port 465); false = STARTTLS (required in production). */
    SMTP_SECURE: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false')).transform((v) => v === 'true'),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    /** Sender, e.g. "GSC Peoples <no-reply@example.com>" on a verified domain. */
    MAIL_FROM: optionalString,
    /** Origin of the web app, used to build the links inside emails, e.g. https://app.example.com */
    WEB_APP_URL: optionalUrl,
    /**
     * development: local dev bearer adapter (never production).
     * session:     first-party email/password with httpOnly cookie sessions (bearer tokens are rejected).
     * sso:         Central Authentication bearer tokens (JWKS) in addition to cookie sessions.
     */
    AUTH_MODE: z.enum(['development', 'session', 'sso']).default('development'),
    CENTRAL_AUTH_BASE_URL: optionalUrl,
    CENTRAL_AUTH_JWKS_URL: optionalUrl,
    CENTRAL_AUTH_ISSUER: optionalString,
    CENTRAL_AUTH_AUDIENCE: optionalString,
    DEV_AUTH_COMPANY_ID: z.string().min(1).default('dev-company'),
    /** Explicit opt-in for the local development token adapter. Never allowed in production. */
    DEV_AUTH_ENABLED: z.preprocess(emptyToUndefined, z.enum(['true', 'false']).default('false')).transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_AUTH_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_AUTH_ENABLED'],
        message: 'DEV_AUTH_ENABLED is not allowed when NODE_ENV=production',
      });
    }
    if (env.AUTH_MODE === 'sso' && (!env.CENTRAL_AUTH_JWKS_URL || !env.CENTRAL_AUTH_ISSUER || !env.CENTRAL_AUTH_AUDIENCE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CENTRAL_AUTH_JWKS_URL'],
        message: 'SSO mode requires CENTRAL_AUTH_JWKS_URL, CENTRAL_AUTH_ISSUER and CENTRAL_AUTH_AUDIENCE',
      });
    }
    if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'AUTH_MODE=development is not allowed when NODE_ENV=production; use session or sso',
      });
    }
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS_EXPLICIT) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be set explicitly when NODE_ENV=production',
      });
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS_EXPLICIT) {
      // Credentialed CORS compares origins exactly: a wildcard, a path or a trailing slash can never work, and a
      // plain-http origin would receive session cookies over an unprotected channel.
      for (const origin of env.CORS_ORIGINS) {
        if (!/^https:\/\/[^\s/*?#]+$/.test(origin)) {
          ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'each CORS origin must be an exact https origin such as https://app.example.com (no wildcard, path or trailing slash)' });
          break;
        }
      }
    }
    if (env.NODE_ENV === 'production' && !env.MAIL_DRIVER) {
      ctx.addIssue({ code: 'custom', path: ['MAIL_DRIVER'], message: 'MAIL_DRIVER must be set when NODE_ENV=production: smtp, or disabled to run without invitation and reset emails' });
    }
    if (env.MAIL_DRIVER === 'smtp') {
      for (const k of ['SMTP_HOST', 'MAIL_FROM', 'WEB_APP_URL'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when MAIL_DRIVER=smtp` });
      }
      if (env.NODE_ENV === 'production' && env.WEB_APP_URL && !env.WEB_APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['WEB_APP_URL'], message: 'WEB_APP_URL must be https when NODE_ENV=production' });
      }
    }
    if (env.DOCUMENT_STORAGE_DRIVER === 'supabase') {
      for (const k of ['SUPABASE_STORAGE_URL', 'SUPABASE_STORAGE_SERVICE_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when DOCUMENT_STORAGE_DRIVER=supabase` });
      }
    }
    if (env.NODE_ENV === 'production' && env.DOCUMENT_STORAGE_DRIVER !== 'supabase') {
      ctx.addIssue({
        code: 'custom',
        path: ['DOCUMENT_STORAGE_DRIVER'],
        message: 'DOCUMENT_STORAGE_DRIVER=supabase is required when NODE_ENV=production (local disk does not survive a redeploy)',
      });
    }
    if (env.DB_TARGET === 'supabase') {
      for (const k of ['SUPABASE_DATABASE_URL', 'SUPABASE_CA_CERT_PATH'] as const) {
        if (!env[k]) {
          ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when DB_TARGET=supabase` });
        }
      }
    } else if (env.NODE_ENV !== 'test' && !env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required (dedicated HR database)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse({
    ...source,
    // Platform-assigned PORT is used only when API_PORT is not set explicitly.
    API_PORT: source.API_PORT?.trim() ? source.API_PORT : source.PORT,
    CORS_ORIGINS_EXPLICIT: typeof source.CORS_ORIGINS === 'string' && source.CORS_ORIGINS.trim() !== '',
  });
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const data = result.data;
  // Single resolution point: everything downstream keeps reading `env.DATABASE_URL`.
  // The hosted URL must always target the hr schema, even if the configured URL omits `?schema=hr`
  // (Prisma would otherwise default to `public`).
  if (data.DB_TARGET === 'supabase' && data.SUPABASE_DATABASE_URL) {
    const u = new URL(data.SUPABASE_DATABASE_URL);
    u.searchParams.set('schema', 'hr');
    data.DATABASE_URL = u.toString();
  }
  return data;
}

export const env: Env = parseEnv();
