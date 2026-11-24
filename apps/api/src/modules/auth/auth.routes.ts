import { Router, type Response } from 'express';
import { z } from 'zod';
import { normalizeEmail } from '@gsc/shared';
import type { PrismaClient } from '../../database/generated/client';
import { UnauthorizedError, ValidationError } from '../../shared/errors';
import { env } from '../../config/env';
import { hashPassword, secureToken, tokenHash, verifyPassword } from './password';

const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(128), companyId: z.string().uuid().optional(), roleKey: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE']).optional() });
const resetRequestSchema = z.object({ email: z.email(), companyId: z.string().uuid().optional() });
const resetSchema = z.object({ token: z.string().min(32), password: z.string().min(10).max(128) }); // PRD AUTH-002: 10+ characters
const invitationSchema = z.object({ token: z.string().min(32), password: z.string().min(10).max(128), name: z.string().trim().min(1).max(200).optional() });

const failures = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string) {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  if (entry.count >= 5) throw new UnauthorizedError('Too many login attempts. Try again later.');
  entry.count += 1;
}

function clearFailures(key: string) {
  failures.delete(key);
}

function setSessionCookies(res: Response, sessionToken: string, csrfToken: string) {
  const secure = env.NODE_ENV === 'production';
  const domain = env.COOKIE_DOMAIN;
  res.cookie('gsc_session', sessionToken, { httpOnly: true, secure, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000, path: '/', ...(domain ? { domain } : {}) });
  res.cookie('gsc_csrf', csrfToken, { httpOnly: false, secure, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000, path: '/', ...(domain ? { domain } : {}) });
}

function clearSessionCookies(res: Response) {
  const domain = env.COOKIE_DOMAIN;
  res.clearCookie('gsc_session', { path: '/', ...(domain ? { domain } : {}) });
  res.clearCookie('gsc_csrf', { path: '/', ...(domain ? { domain } : {}) });
}

async function createSession(prisma: PrismaClient, userId: string, companyId: string, res: Response) {
  const sessionToken = secureToken();
  const csrfToken = secureToken();
  const now = new Date();
  await prisma.userSession.create({
    data: {
      userId,
      companyId,
      tokenHash: tokenHash(sessionToken),
      csrfHash: tokenHash(csrfToken),
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
      lastActivityAt: now,
    },
  });
  setSessionCookies(res, sessionToken, csrfToken);
}

export function createAuthRouter(prisma: PrismaClient): Router {
  const router = Router();

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
    if (!user || user.status !== 'ACTIVE' || !user.passwordHash ||
        (parsed.data.companyId && !user.memberships.some((m) => m.companyId === parsed.data.companyId)) ||
        !verifyPassword(parsed.data.password, user.passwordHash) ||
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
      const token = decodeURIComponent(cookie.slice('gsc_session='.length));
      await prisma.userSession.updateMany({ where: { tokenHash: tokenHash(token), revokedAt: null }, data: { revokedAt: new Date() } });
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
    if (user) {
      const memberships = parsed.data.companyId
        ? user.memberships.filter((m) => m.companyId === parsed.data.companyId)
        : user.memberships;
      for (const membership of memberships) {
        const token = secureToken();
        await prisma.passwordResetToken.create({
          data: { companyId: membership.companyId, userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });
        if (env.NODE_ENV !== 'production') res.append('X-Development-Reset-Token', token);
      }
    }
    res.json({ data: { message: 'If the account exists, a reset link has been issued.' } });
  });

  router.post('/reset-password', async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid reset fields', parsed.error.flatten());
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw new UnauthorizedError('Reset link is invalid or expired');

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash: hashPassword(parsed.data.password), passwordVersion: { increment: 1 } },
      });
      await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    res.json({ data: { message: 'Password reset successfully.' } });
  });

  router.post('/accept-invitation', async (req, res) => {
    const parsed = invitationSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid invitation fields', parsed.error.flatten());
    const invitation = await prisma.invitationToken.findUnique({
      where: { tokenHash: tokenHash(parsed.data.token) },
      include: { user: true, membership: true },
    });
    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw new UnauthorizedError('Invitation link is invalid, expired, or already used');
    }

    await prisma.$transaction(async (tx) => {
      await tx.invitationToken.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: invitation.userId },
        data: { name: parsed.data.name ?? invitation.user.name, passwordHash: hashPassword(parsed.data.password), passwordVersion: { increment: 1 }, status: 'ACTIVE' },
      });
      await tx.companyMembership.update({
        where: { id: invitation.membershipId },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
    });
    await createSession(prisma, invitation.userId, invitation.companyId, res);
    res.json({ data: { companyId: invitation.companyId, activated: true } });
  });

  return router;
}
