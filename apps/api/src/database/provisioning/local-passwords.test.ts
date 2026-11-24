import { scryptSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../../modules/auth/password';
import { defaultSpec } from './local-provisioning';
import {
  assertLocalPasswordTarget,
  assertPasswordAcceptable,
  findLocalUserId,
  resolveProvisionedEmails,
  setLocalUserPassword,
} from './local-passwords';

const PASSWORD = 'correct horse battery staple';

type Call = { sql: string; params: unknown[] };

/** Fake pg client: `users` answers the lookup; every statement is recorded. */
function fakeClient(opts: { users?: string[]; updateCount?: number } = {}) {
  const calls: Call[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT DISTINCT u.id')) return { rows: (opts.users ?? ['user-1']).map((id) => ({ id })) };
    if (sql.startsWith('UPDATE')) return { rows: [], rowCount: opts.updateCount ?? 1 };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as never, calls };
}

describe('password hashing', () => {
  it('stores a login-compatible scrypt hash (same code path and parameters as login)', async () => {
    const { client, calls } = fakeClient();
    await setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD);
    const update = calls.find((c) => c.sql.startsWith('UPDATE'))!;
    const hash = update.params[0] as string;
    const [scheme, salt, digest] = hash.split('$');
    expect(scheme).toBe('scrypt');
    expect(verifyPassword(PASSWORD, hash)).toBe(true);
    expect(verifyPassword('another password', hash)).toBe(false);
    expect(digest).toBe(scryptSync(PASSWORD, salt!, 64).toString('hex'));
  });

  it('uses a fresh salt each time', async () => {
    const a = fakeClient();
    const b = fakeClient();
    await setLocalUserPassword(a.client, 'dev-company', 'hana.admin@dev.local', PASSWORD);
    await setLocalUserPassword(b.client, 'dev-company', 'hana.admin@dev.local', PASSWORD);
    const hashOf = (calls: Call[]) => calls.find((c) => c.sql.startsWith('UPDATE'))!.params[0];
    expect(hashOf(a.calls)).not.toBe(hashOf(b.calls));
  });
});

describe('account lookup', () => {
  it('normalizes the email and scopes the lookup to the company', async () => {
    const { client, calls } = fakeClient();
    await expect(findLocalUserId(client, 'dev-company', '  Hana.Admin@Dev.Local ')).resolves.toBe('user-1');
    expect(calls[0]!.params).toEqual(['hana.admin@dev.local', 'dev-company']);
  });

  it('fails when the user does not exist and never inserts one', async () => {
    const { client, calls } = fakeClient({ users: [] });
    await expect(setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD)).rejects.toThrow(
      /No existing user/,
    );
    expect(calls.some((c) => /INSERT/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
  });

  it('refuses an ambiguous email instead of guessing', async () => {
    const { client, calls } = fakeClient({ users: ['a', 'b'] });
    await expect(setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD)).rejects.toThrow(
      /more than one user/,
    );
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('provisions one dev persona for each of the four roles', () => {
    expect(defaultSpec('dev-company').people.map((p) => p.roleKey).sort()).toEqual([
      'EMPLOYEE',
      'HR_ADMIN',
      'MANAGER',
      'SUPER_ADMIN',
    ]);
  });

  it('only accepts provisioned development personas', () => {
    const spec = defaultSpec('dev-company');
    expect(resolveProvisionedEmails(spec, ['Hana.Admin@dev.local', 'mia.manager@dev.local', 'hana.admin@dev.local'])).toEqual([
      'hana.admin@dev.local',
      'mia.manager@dev.local',
    ]);
    expect(() => resolveProvisionedEmails(spec, ['someone@example.com'])).toThrow(/not a provisioned development user/);
    expect(() => resolveProvisionedEmails(spec, [])).toThrow(/No users selected/);
  });
});

describe('update scope', () => {
  it('updates only passwordHash of the selected user, in one transaction', async () => {
    const { client, calls } = fakeClient();
    await setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD);
    const update = calls.filter((c) => c.sql.startsWith('UPDATE'));
    expect(update).toHaveLength(1);
    expect(update[0]!.sql).toBe('UPDATE hr.users SET "passwordHash" = $1 WHERE id = $2');
    expect(update[0]!.params[1]).toBe('user-1');
    // Every other statement is the lookup SELECT or transaction control: no writes elsewhere.
    const others = calls.filter((c) => !c.sql.startsWith('UPDATE')).map((c) => c.sql.trim().split(/\s/)[0]);
    expect(new Set(others)).toEqual(new Set(['BEGIN', 'SELECT', 'COMMIT']));
    expect(calls[0]!.sql).toBe('BEGIN');
    expect(calls.at(-1)!.sql).toBe('COMMIT');
  });

  it('rolls back when the update does not change exactly one row', async () => {
    const { client, calls } = fakeClient({ updateCount: 0 });
    await expect(setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD)).rejects.toThrow(
      /exactly 1 user/,
    );
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
  });
});

describe('database restrictions', () => {
  const ok = (url: string) => assertLocalPasswordTarget(url, 'development');

  it('allows localhost with hr_db or hr_test', () => {
    expect(ok('postgresql://u:p@localhost:5432/hr_db')).toEqual({ host: 'localhost', database: 'hr_db' });
    expect(ok('postgresql://u:p@127.0.0.1:5432/hr_test').database).toBe('hr_test');
  });

  it('rejects remote hosts', () => {
    expect(() => ok('postgresql://u:p@db.example.com:5432/hr_db')).toThrow(/SAFEGUARD.*host/);
    expect(() => ok('postgresql://u:p@10.0.0.5:5432/hr_db')).toThrow(/SAFEGUARD/);
  });

  it('rejects other databases', () => {
    expect(() => ok('postgresql://u:p@localhost:5432/hr_staging')).toThrow(/SAFEGUARD.*database/);
    expect(() => ok('postgresql://u:p@localhost:5432/postgres')).toThrow(/SAFEGUARD/);
  });

  it('rejects production even for a local database', () => {
    expect(() => assertLocalPasswordTarget('postgresql://u:p@localhost:5432/hr_db', 'production')).toThrow(
      /NODE_ENV=production/,
    );
  });
});

describe('failure cases', () => {
  it('rejects passwords outside the login/reset length bounds', () => {
    expect(() => assertPasswordAcceptable('short')).toThrow(/at least 10/);
    expect(() => assertPasswordAcceptable('x'.repeat(129))).toThrow(/at most 128/);
    expect(() => assertPasswordAcceptable('x'.repeat(10))).not.toThrow();
  });

  it('does not touch the database for an unacceptable password', async () => {
    const { client, calls } = fakeClient();
    await expect(setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', 'short')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('never puts the password or hash in an error message', async () => {
    const { client } = fakeClient({ users: [] });
    const error = await setLocalUserPassword(client, 'dev-company', 'hana.admin@dev.local', PASSWORD).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).not.toContain(PASSWORD);
    expect((error as Error).message).not.toContain('scrypt$');
  });
});
