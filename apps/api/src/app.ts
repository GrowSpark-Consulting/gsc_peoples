import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { getPrisma, isDatabaseConfigured } from './database/client';
import { createIdentityStore } from './database/identity';
import { createTenantRunner } from './database/tenant';
import { assertTenantMeta } from './database/tenant/assert-meta';
import {
  createAuthProvider,
  type CentralAuthProvider,
} from './integrations/central-auth';
import { authenticate } from './middleware/auth/authenticate';
import { requireCsrf } from './middleware/auth/csrf';
import { rateLimit } from './middleware/rate-limit';
import { resolveTenant, type MembershipResolver } from './middleware/auth/resolve-tenant';
import { errorHandler, notFoundHandler } from './middleware/error/error-handler';
import { requestLogger } from './middleware/request-logger';
import { createDepartmentRepository } from './modules/departments/departments.repository';
import { createDepartmentsRouter } from './modules/departments/departments.routes';
import { createEmployeeRepository, type TenantRunner } from './modules/employees/employees.repository';
import { createEmployeesRouter } from './modules/employees/employees.routes';
import { createEmployeeService } from './modules/employees/employees.service';
import { createMeRouter, type CompanyLoader } from './modules/me/me.routes';
import { createHolidayRepository } from './modules/holidays/holidays.repository';
import { createHolidaysRouter } from './modules/holidays/holidays.routes';
import { withRequestTenantContext } from './database/tenant/request-context';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createSettingsRouter } from './modules/settings/settings.routes';
import { createOrganizationRouter } from './modules/organization/organization.routes';
import { createNotificationsRouter } from './modules/notifications/notifications.routes';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes';
import { createOnboardingRouter } from './modules/onboarding/onboarding.routes';
import { createAttendanceRouter } from './modules/attendance/attendance.routes';
import { createLeaveRouter } from './modules/leave/leave.routes';
import { createDocumentsRouter, createLocalFileRouter } from './modules/documents/documents.routes';
import { createDocumentStorage, type DocumentStorage, type LocalDocumentStorage } from './integrations/storage';
import { SessionAuthProvider } from './integrations/local-auth/session-provider';
import { createMailer, type Mailer } from './integrations/mail';
import { createInvitationService } from './modules/auth/invitations';
import { healthRouter } from './modules/health/health.routes';
import { API_PREFIX } from './shared/constants';

/** Overridable collaborators. Production uses the defaults; tests inject in-memory fakes. */
export interface AppDependencies {
  authProvider?: CentralAuthProvider;
  sessionProvider?: CentralAuthProvider;
  resolveMembership?: MembershipResolver;
  tenantRunner?: TenantRunner;
  /** Test seam: the clock behind attendance, leave and dashboard date rules (default: wall-clock time). */
  clock?: () => Date;
  /** Document object storage. Default: the driver selected by DOCUMENT_STORAGE_DRIVER. */
  documentStorage?: DocumentStorage;
  /** Outbound email. Default: the driver selected by MAIL_DRIVER. */
  mailer?: Mailer;
}

export function createApp(deps: AppDependencies = {}): Express {
  assertTenantMeta(); // fail closed if the tenant metadata is empty or wrong

  const app = express();
  app.disable('x-powered-by');
  // Behind Render's proxy req.ip would otherwise be the proxy for every user (breaking the per-ip login limiter).
  const proxyHops = env.TRUST_PROXY_HOPS ?? (env.NODE_ENV === 'production' ? 1 : 0);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: ['authorization', 'content-type', 'x-request-id', 'x-csrf-token'],
    }),
  );
  app.use(requestLogger);
  app.use(express.json({ limit: '1mb' }));

  // Database collaborators are created lazily so the app (and its public routes) can start,
  // and unit tests can run, without a configured database.
  const resolveMembership: MembershipResolver =
    deps.resolveMembership ?? ((input) => createIdentityStore(getPrisma()).resolveActiveMembership(input));
  let runner = deps.tenantRunner;
  const tenantRunner: TenantRunner = (ctx, fn) => (runner ??= createTenantRunner(getPrisma()))(ctx, fn);

  const api = express.Router();
  // Public routes first.
  // Authenticated and personal data must never be stored by a browser or an intermediary cache.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(healthRouter);
  if (env.NODE_ENV !== 'test') {
    // Per client IP (req.ip honours TRUST_PROXY_HOPS). The per-account login counter in auth.routes stays on top.
    api.use(rateLimit({ windowMs: 60_000, max: env.RATE_LIMIT_PER_MINUTE }));
    api.use('/auth', rateLimit({ windowMs: 15 * 60_000, max: env.AUTH_RATE_LIMIT_PER_15_MIN, skip: (r) => r.method === 'GET' || r.path === '/logout' }));
  }
  const documentStorage = deps.documentStorage ?? createDocumentStorage(env);
  // Local-driver (development) download links carry their own 60-second HMAC authorisation, like a Supabase
  // signed URL, so that one route sits before the session middleware. Never mounted for the supabase driver.
  if (documentStorage.driver === 'local') api.use('/documents', createLocalFileRouter(documentStorage as LocalDocumentStorage));

  const prisma = isDatabaseConfigured() ? getPrisma() : undefined;
  // Cookie sessions live in PostgreSQL: without a database the session modes cannot authenticate anyone.
  if (!prisma && !deps.sessionProvider && env.AUTH_MODE !== 'development') {
    throw new Error(`AUTH_MODE=${env.AUTH_MODE} requires a configured database (DATABASE_URL)`);
  }
  const mailer = deps.mailer ?? createMailer(env);
  if (prisma) api.use('/auth', createAuthRouter(prisma, { mailer, webAppUrl: env.WEB_APP_URL }));

  // Everything registered after this line requires authentication (who you are) ...
  api.use(authenticate(
    deps.authProvider ?? createAuthProvider(),
    deps.sessionProvider ?? (prisma ? new SessionAuthProvider(prisma) : undefined),
  ));
  api.use(requireCsrf(prisma));

  // ... and feature routes also require a validated ACTIVE company membership (which company).
  const tenant = resolveTenant(resolveMembership);
  // /me includes the caller's company configuration (timezone, working days and hours). Only available
  // with a database; the company id is the validated membership's, never request input.
  const loadCompany = prisma || deps.tenantRunner
    ? async (companyId: string) =>
        tenantRunner<Awaited<ReturnType<CompanyLoader>>>({ companyId }, (db) =>
          db.company.findFirst({
            where: { id: companyId },
            select: { name: true, timezone: true, workingDays: true, workStartTime: true, workEndTime: true },
          }),
        )
    : undefined;
  api.use('/me', tenant, createMeRouter(loadCompany));
  // Routers that talk to Prisma directly get a client that carries the request's tenant into Postgres RLS
  // (`app.company_id`, set from the validated membership by `resolveTenant`). A raw PrismaClient here would
  // see no rows at all once RLS is enabled on the table (fail closed), so never pass `prisma` itself.
  const tenantPrisma = prisma ? withRequestTenantContext(prisma) : undefined;
  // One invitation implementation behind both the employee record and the user-accounts screen. The raw token is
  // returned to the caller only outside production, for local development and tests.
  const invitations = tenantPrisma
    ? createInvitationService(tenantPrisma, { mailer, webAppUrl: env.WEB_APP_URL, exposeToken: env.NODE_ENV !== 'production' })
    : undefined;
  if (tenantPrisma && invitations) api.use('/settings', tenant, createSettingsRouter(tenantPrisma, tenantRunner, invitations));
  api.use('/employees', tenant, createEmployeesRouter(createEmployeeService(createEmployeeRepository(tenantRunner), invitations)));
  // Keep legacy read-only departments endpoint for existing consumers, and also expose full org routes.
  api.use('/holidays', tenant, createHolidaysRouter(createHolidayRepository(tenantRunner)));
  api.use('/departments', tenant, createDepartmentsRouter(createDepartmentRepository(tenantRunner)));
  if (tenantPrisma) {
    api.use('/organization', tenant, createOrganizationRouter(tenantPrisma, tenantRunner));
    api.use('/onboarding', tenant, createOnboardingRouter(tenantPrisma, tenantRunner));
    api.use('/attendance', tenant, createAttendanceRouter(tenantPrisma, tenantRunner, { now: deps.clock }));
    api.use('/leave', tenant, createLeaveRouter(tenantPrisma, tenantRunner, { now: deps.clock }));
    api.use('/documents', tenant, createDocumentsRouter(tenantPrisma, tenantRunner, documentStorage));
    api.use('/dashboard', tenant, createDashboardRouter(tenantPrisma, tenantRunner, { now: deps.clock }));
    api.use('/notifications', tenant, createNotificationsRouter(tenantPrisma));
  }

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
