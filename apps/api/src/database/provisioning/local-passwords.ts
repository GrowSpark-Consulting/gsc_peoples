import type pg from 'pg';
import { normalizeEmail } from '@gsc/shared';
import { hashPassword } from '../../modules/auth/password';
import { assertLocalTarget, type LocalProvisionSpec } from './local-provisioning';

/**
 * LOCAL DEVELOPMENT PASSWORD PROVISIONING (CLI only, never reachable from the API or browser).
 *
 * Sets `hr.users."passwordHash"` for users that local provisioning already created. It never inserts
 * users, never touches roles, memberships or employees, and never returns or logs a password or hash.
 * Hashing is `hashPassword` from the login module, so the scrypt parameters cannot drift from login.
 */

/** Same bounds the reset/invitation flows enforce (PRD AUTH-002: 10+ characters). */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/** Refuses production, remote hosts and any database other than hr_db / hr_test. */
export function assertLocalPasswordTarget(
  connectionUrl: string,
  nodeEnv: string | undefined,
): { host: string; database: string } {
  if (nodeEnv === 'production') {
    throw new Error('SAFEGUARD: setting local passwords refuses to run with NODE_ENV=production');
  }
  return assertLocalTarget(connectionUrl);
}

/** Only the people local provisioning creates may be given a password; returns normalized emails. */
export function resolveProvisionedEmails(spec: LocalProvisionSpec, emails: string[]): string[] {
  if (emails.length === 0) throw new Error('No users selected');
  const known = new Set(spec.people.map((p) => normalizeEmail(p.email)));
  const resolved: string[] = [];
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!known.has(email)) {
      throw new Error(`"${email}" is not a provisioned development user. Allowed: ${[...known].join(', ')}`);
    }
    if (!resolved.includes(email)) resolved.push(email);
  }
  return resolved;
}

/** Finds the one existing user with this email that belongs to the company. Never creates anything. */
export async function findLocalUserId(
  client: Pick<pg.Client, 'query'>,
  companyId: string,
  email: string,
): Promise<string> {
  const normalized = normalizeEmail(email);
  const { rows } = await client.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM hr.users u
     JOIN hr.company_memberships m ON m."userId" = u.id
     WHERE lower(btrim(u.email)) = $1 AND m."companyId" = $2`,
    [normalized, companyId],
  );
  if (rows.length === 0) {
    throw new Error(`No existing user "${normalized}" in company "${companyId}". Run pnpm db:provision:local first.`);
  }
  if (rows.length > 1) throw new Error(`Email "${normalized}" matches more than one user; refusing to guess`);
  return rows[0]!.id;
}

/** Updates exactly one column of exactly one user, in one transaction. */
export async function setLocalUserPassword(
  client: Pick<pg.Client, 'query'>,
  companyId: string,
  email: string,
  password: string,
): Promise<void> {
  assertPasswordAcceptable(password);
  await client.query('BEGIN');
  try {
    const userId = await findLocalUserId(client, companyId, email);
    const result = await client.query(`UPDATE hr.users SET "passwordHash" = $1 WHERE id = $2`, [
      hashPassword(password),
      userId,
    ]);
    if (result.rowCount !== 1) throw new Error(`Expected to update exactly 1 user, updated ${result.rowCount ?? 0}`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
