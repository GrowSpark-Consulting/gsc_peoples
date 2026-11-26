import { Router, type Response } from 'express';
import { z } from 'zod';
import { normalizeEmail } from '@gsc/shared';
import { env } from '../../config/env';
import type { PrismaClient } from '../../database/generated/client';
import { createTenantRunner } from '../../database/tenant';
import { disabledMailer, passwordResetEmail, PASSWORD_RESET_TTL_MINUTES, type Mailer } from '../../integrations/mail';
import { UnauthorizedError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/utils/logger';
import { decodeCookieValue } from '../../middleware/auth/cookie-value';
import { hrUserIds, notify } from '../notifications/notify';
import { hashPassword, hashPasswordAsync, secureToken, tokenHashAsync, verifyPasswordAsync } from './password';

const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(128), companyId: z.string().uuid().optional(), roleKey: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']).optional() });
const resetRequestSchema = z.object({ email: z.email(), companyId: z.string().uuid().optional() });
const resetSchema = z.object({ token: z.string().min(32).max(256), password: z.string().min(10).max(128) }); // PRD AUTH-002: 10+ characters
const invitationSchema = z.object({ token: z.string().min(32).max(256), password: z.string().min(10).max(128), name: z.string().trim().min(1).max(200).optional() });

/** PRD section 5: 5 failed logins per 15 minutes. Process-local: one API instance is the supported topology. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();
let lastSweep = Date.now();

function checkRateLimit(key: string) {
  const now = Date.now();
  if (now - lastSweep > FAILURE_WINDOW_MS) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
    lastSweep = now;
  }
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    return;
  }
  if (entry.count >= MAX_FAILURES) throw new UnauthorizedError('Too many login attempts. Try again later.');
  entry.count += 1;
}

function clearFailures(key: string) {
  failures.delete(key);
}

// Verified when the account does not exist, so an unknown email costs the same time as a wrong password.
// Computed once at module load (startup), never per request.
const DUMMY_HASH = hashPassword(secureToken());

const SESSION_MS = 8 * 60 * 60 * 1000;

function setSessionCookies(res: Response, sessionToken: string, csrfToken: string) {
  const secure = env.NODE_ENV === 'production';
  const domain = env.COOKIE_DOMAIN;
  res.cookie('gsc_session', sessionToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: SESSION_MS, path: '/', ...(domain ? { domain } : {}) });
  res.cookie('gsc_csrf', csrfToken, { httpOnly: false, secure, sameSite: 'lax', maxAge: SESSION_MS, path: '/', ...(domain ? { domain } : {}) });
}

function clearSessionCookies(res: Response) {
  const domain = env.COOKIE_DOMAIN;
  res.clearCookie('gsc_session', { path: '/', ...(domain ? { domain } : {}) });
  res.clearCookie('gsc_csrf', { path: '/', ...(domain ? { domain } : {}) });
}

async function createSession(prisma: PrismaClient, userId: string, companyId: string, res: Response) {
  const sessionToken = secureToken();
  const csrfToken = secureToken();
  const [sessionHash, csrfHash] = await Promise.all([tokenHashAsync(sessionToken), tokenHashAsync(csrfToken)]);
  const now = new Date();
  await prisma.userSession.create({
    data: {
      userId,
      companyId,
      tokenHash: sessionHash,
      csrfHash,
      expiresAt: new Date(now.getTime() + SESSION_MS),
      lastActivityAt: now,
    },
  });
  setSessionCookies(res, sessionToken, csrfToken);
}

export interface AuthRouterOptions {
  mailer?: Mailer;
  webAppUrl?: string;
}

export function createAuthRouter(prisma: PrismaClient, options: AuthRouterOptions = {}): Router {
  const router = Router();
  const mailer = options.mailer ?? disabledMailer;
  // Reset and invitation completion write company-scoped rows (audit, notifications): the company comes from the
  // verified single-use token, never from the request body.
  const run = createTenantRunner(prisma);
  const invalidInvitation = () => new UnauthorizedError('Invitation link is invalid, expired, or already used');
  const invalidReset = () => new UnauthorizedError('Reset link is invalid or expired');

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid login fields', parsed.error.flatten());
    const email = normalizeEmail(parsed.data.email);
    const key = `${req.ip}:${email}`;
    checkRateLimit(key);

    const user = await prisma.user.findFirst({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' }, include: { role: true } } },
    });
    const passwordOk = await verifyPasswordAsync(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash || !passwordOk ||
        (parsed.data.companyId && !user.memberships.some((m) => m.companyId === parsed.data.companyId)) ||
        // The selected role is only a check against the database role, never a way to choose one.
        (parsed.data.roleKey && !user.memberships.some((m) => m.role.key === parsed.data.roleKey))) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const roleMemberships = parsed.data.roleKey
      ? user.memberships.filter((m) => m.role.key === parsed.data.roleKey)
      : user.memberships;
    const memberships = parsed.data.companyId
      ? roleMemberships.filter((m) => m.companyId === parsed.data.companyId)
      : roleMemberships;
    if (memberships.length !== 1) {
      throw new ValidationError('Select an active company', { companyId: 'Required when a user belongs to multiple companies' });
    }
    const membership = memberships[0];
    if (!membership) throw new ValidationError('Select an active company');

    clearFailures(key);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await tx.userSession.deleteMany({ where: { userId: user.id, revokedAt: null, expiresAt: { lte: new Date() } } });
    });
    await createSession(prisma, user.id, membership.companyId, res);

    res.json({ data: { userId: user.id, companyId: membership.companyId, roleKey: membership.role.key } });
  });

  router.post('/logout', async (req, res) => {
    const cookieHeader = req.headers.cookie;
    const cookie = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith('gsc_session='));
    if (cookie) {
      const token = decodeCookieValue(cookie.slice('gsc_session='.length));
      await prisma.userSession.updateMany({ where: { tokenHash: await tokenHashAsync(token), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    clearSessionCookies(res);
    res.status(204).send();
  });

  router.post('/forgot-password', async (req, res) => {
    const parsed = resetRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid password reset fields', parsed.error.flatten());
    const email = normalizeEmail(parsed.data.email);
    const user = await prisma.user.findFirst({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' } } },
    });
    // Only an account that can actually sign in gets a link. The answer is identical either way.
    if (user && user.status === 'ACTIVE' && user.passwordHash) {
      const membership = parsed.data.companyId
        ? user.memberships.find((m) => m.companyId === parsed.data.companyId)
        : user.memberships[0];
      if (membership) {
        const token = secureToken();
        const resetTokenHash = await tokenHashAsync(token); // hashed before the transaction: no CPU work while it holds a connection
        await prisma.$transaction(async (tx) => {
          // Only the newest link works.
          await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
          await tx.passwordResetToken.create({
            data: { companyId: membership.companyId, userId: user.id, tokenHash: resetTokenHash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000) },
          });
        });
        if (env.NODE_ENV !== 'production') res.append('X-Development-Reset-Token', token);
        if (mailer.driver !== 'disabled') {
          // Not awaited: waiting on the mail server would make known addresses measurably slower than unknown ones.
          mailer
            .send(passwordResetEmail({ to: user.email, token, webAppUrl: options.webAppUrl ?? 'http://localhost:3000' }))
            .catch((err: unknown) => logger.error({ err }, 'password reset email failed'));
        } else {
          logger.warn('password reset requested but email delivery is disabled');
        }
      }
    }
    res.json({ data: { message: 'If the account exists, a reset link has been issued.' } });
  });

  router.post('/reset-password', async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid reset fields', parsed.error.flatten());
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: await tokenHashAsync(parsed.data.token) }, include: { user: { select: { status: true } } } });
    if (!record || record.usedAt || record.expiresAt <= new Date() || record.user.status !== 'ACTIVE') throw invalidReset();
    const passwordHash = await hashPasswordAsync(parsed.data.password);

    await run({ companyId: record.companyId }, async (db, tx) => {
      // Single use even under concurrency: only the request that flips `usedAt` may change the password.
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw invalidReset();
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, passwordVersion: { increment: 1 } } });
      await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await db.auditLog.create({ data: { actorId: record.userId, action: 'PASSWORD_RESET', entity: 'user', entityId: record.userId } });
    });
    res.json({ data: { message: 'Password reset successfully.' } });
  });

  router.post('/accept-invitation', async (req, res) => {
    const parsed = invitationSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid invitation fields', parsed.error.flatten());
    const invitation = await prisma.invitationToken.findUnique({
      where: { tokenHash: await tokenHashAsync(parsed.data.token) },
      include: { user: true, membership: true },
    });
    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= new Date() ||
        invitation.membership.status !== 'INVITED' || invitation.user.status !== 'ACTIVE') {
      throw invalidInvitation();
    }
    const passwordHash = await hashPasswordAsync(parsed.data.password);
    const employeeId = invitation.membership.employeeId;

    await run({ companyId: invitation.companyId }, async (db, tx) => {
      const claimed = await tx.invitationToken.updateMany({
        where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw invalidInvitation();
      const employee = employeeId ? await db.employee.findFirst({ where: { id: employeeId }, select: { status: true, firstName: true, lastName: true } }) : null;
      if (employeeId && (!employee || employee.status === 'INACTIVE' || employee.status === 'TERMINATED')) throw invalidInvitation();
      const name = parsed.data.name ?? invitation.user.name;
      await tx.user.update({ where: { id: invitation.userId }, data: { name, passwordHash, passwordVersion: { increment: 1 } } });
      const activated = await tx.companyMembership.updateMany({ where: { id: invitation.membershipId, status: 'INVITED' }, data: { status: 'ACTIVE', joinedAt: new Date() } });
      if (activated.count !== 1) throw invalidInvitation();
      await db.auditLog.create({ data: { actorId: invitation.userId, action: 'INVITATION_ACCEPTED', entity: 'user', entityId: invitation.userId, newValue: { membershipId: invitation.membershipId } } });
      if (employeeId) {
        await db.employeeAuditLog.create({ data: { employeeId, actorUserId: invitation.userId, action: 'INVITATION_ACTIVATED', changes: {} } });
      }
      await notify(db, {
        type: 'INVITATION_ACCEPTED', // PRD W4: HR notified
        eventKey: invitation.id,
        recipients: await hrUserIds(db),
        actorUserId: invitation.userId,
        title: `${employee ? `${employee.firstName} ${employee.lastName}` : (name ?? invitation.user.email)} activated their account`,
        link: employeeId ? `/employees/${employeeId}` : '/settings',
      });
    });
    await createSession(prisma, invitation.userId, invitation.companyId, res);
    res.json({ data: { companyId: invitation.companyId, activated: true } });
  });

  return router;
}
