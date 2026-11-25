import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../config/env';
import { DevAuthProvider, DisabledAuthProvider } from './dev.provider';
import { createAuthProvider } from './index';
import { SsoProvider } from './sso.provider';

const base = { AUTH_MODE: 'development', DEV_AUTH_COMPANY_ID: 'c1' } as const;
const url = 'postgresql://u:p@localhost:5432/hr_db?schema=hr';

describe('development auth gating (production safety)', () => {
  it('production refuses development adapter in the factory', () => {
    expect(() =>
      createAuthProvider({ ...base, NODE_ENV: 'production', DEV_AUTH_ENABLED: true }),
    ).toThrow(/never run in production/);
    expect(() =>
      createAuthProvider({ ...base, NODE_ENV: 'production', DEV_AUTH_ENABLED: false }),
    ).toThrow(/never run in production/);
  });

  it('production config validation rejects DEV_AUTH_ENABLED and AUTH_MODE=development', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', AUTH_MODE: 'sso', DATABASE_URL: url, DEV_AUTH_ENABLED: 'true' }),
    ).toThrow(/DEV_AUTH_ENABLED/);
    expect(() =>
      parseEnv({ NODE_ENV: 'production', AUTH_MODE: 'development', DATABASE_URL: url }),
    ).toThrow(/AUTH_MODE/);
  });

  it('development without the explicit flag fails closed', async () => {
    const p = createAuthProvider({ ...base, NODE_ENV: 'development', DEV_AUTH_ENABLED: false });
    expect(p).toBeInstanceOf(DisabledAuthProvider);
    await expect(p.verifyToken('dev:dev-hr-admin')).rejects.toThrow();
  });

  it('only NODE_ENV=development enables it (test does not)', () => {
    expect(createAuthProvider({ ...base, NODE_ENV: 'test', DEV_AUTH_ENABLED: true })).toBeInstanceOf(
      DisabledAuthProvider,
    );
    expect(createAuthProvider({ ...base, NODE_ENV: 'development', DEV_AUTH_ENABLED: true })).toBeInstanceOf(
      DevAuthProvider,
    );
  });

  it('sso mode requires JWKS, issuer and audience configuration', () => {
    expect(() => createAuthProvider({
      ...base,
      AUTH_MODE: 'sso',
      NODE_ENV: 'development',
      DEV_AUTH_ENABLED: true,
      CENTRAL_AUTH_JWKS_URL: undefined,
      CENTRAL_AUTH_ISSUER: undefined,
      CENTRAL_AUTH_AUDIENCE: undefined,
    })).toThrow(/requires JWKS URL, issuer and audience/);

    const p = createAuthProvider({
      ...base,
      AUTH_MODE: 'sso',
      NODE_ENV: 'development',
      DEV_AUTH_ENABLED: true,
      CENTRAL_AUTH_JWKS_URL: 'https://auth.example/.well-known/jwks.json',
      CENTRAL_AUTH_ISSUER: 'https://auth.example/',
      CENTRAL_AUTH_AUDIENCE: 'gsc-peoples',
    });
    expect(p).toBeInstanceOf(SsoProvider);
  });

  it('dev provider accepts only provisioned ids, with no roles or extra segments', async () => {
    const p = new DevAuthProvider('c1');
    await expect(p.verifyToken('dev:dev-manager')).resolves.toEqual({ externalId: 'dev-manager', companyId: 'c1' });
    for (const bad of ['dev:someone-else', 'dev:dev-manager:HR_ADMIN', 'dev:', 'x:dev-manager', 'dev-manager', 'dev:dev-manager:']) {
      await expect(p.verifyToken(bad)).rejects.toThrow();
    }
  });

  it('session mode is allowed in production, needs no SSO, and accepts no bearer token', async () => {
    const p = createAuthProvider({ ...base, AUTH_MODE: 'session', NODE_ENV: 'production', DEV_AUTH_ENABLED: false });
    expect(p).toBeInstanceOf(DisabledAuthProvider);
    await expect(p.verifyToken('dev:dev-hr-admin')).rejects.toThrow();
  });

  it('production config: session passes; unset auth mode, missing database or implicit CORS fail closed', () => {
    const ok = {
      NODE_ENV: 'production',
      AUTH_MODE: 'session',
      DATABASE_URL: url,
      CORS_ORIGINS: 'https://hr.example.com',
      DOCUMENT_STORAGE_DRIVER: 'supabase',
      SUPABASE_STORAGE_URL: 'https://abc.supabase.co',
      SUPABASE_STORAGE_SERVICE_KEY: 'service-key',
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      MAIL_FROM: 'GSC Peoples <no-reply@example.com>',
      WEB_APP_URL: 'https://hr.example.com',
    };
    expect(parseEnv(ok).AUTH_MODE).toBe('session');
    const without = (key: keyof typeof ok) => Object.fromEntries(Object.entries(ok).filter(([k]) => k !== key));
    expect(() => parseEnv(without('AUTH_MODE'))).toThrow(/AUTH_MODE/);
    expect(() => parseEnv(without('DATABASE_URL'))).toThrow(/DATABASE_URL/);
    expect(() => parseEnv(without('CORS_ORIGINS'))).toThrow(/CORS_ORIGINS/);
    // document storage: production never falls back to local disk, and the supabase driver needs its credentials
    expect(() => parseEnv(without('DOCUMENT_STORAGE_DRIVER'))).toThrow(/DOCUMENT_STORAGE_DRIVER/);
    expect(() => parseEnv({ ...ok, DOCUMENT_STORAGE_DRIVER: 'local' })).toThrow(/DOCUMENT_STORAGE_DRIVER/);
    expect(() => parseEnv(without('SUPABASE_STORAGE_SERVICE_KEY'))).toThrow(/SUPABASE_STORAGE_SERVICE_KEY/);
    expect(parseEnv(ok).SUPABASE_STORAGE_BUCKET).toBe('hr-documents');
    // email: production states its choice, and smtp needs a host, a sender and an https web origin for the links
    expect(() => parseEnv(without('MAIL_DRIVER'))).toThrow(/MAIL_DRIVER/);
    expect(parseEnv({ ...ok, MAIL_DRIVER: 'disabled' }).MAIL_DRIVER).toBe('disabled');
    for (const key of ['SMTP_HOST', 'MAIL_FROM', 'WEB_APP_URL'] as const) expect(() => parseEnv(without(key))).toThrow(new RegExp(key));
    expect(() => parseEnv({ ...ok, MAIL_DRIVER: 'brevo' })).toThrow(/MAIL_API_KEY/);
    expect(parseEnv({ ...ok, MAIL_DRIVER: 'brevo', MAIL_API_KEY: 'xkeysib_test' }).MAIL_DRIVER).toBe('brevo');
    expect(() => parseEnv({ ...ok, WEB_APP_URL: 'http://hr.example.com' })).toThrow(/WEB_APP_URL/);
    // CORS: credentialed requests need exact https origins
    for (const bad of ['*', 'http://hr.example.com', 'https://hr.example.com/', 'https://*.example.com', 'https://a.example.com,*']) {
      expect(() => parseEnv({ ...ok, CORS_ORIGINS: bad }), bad).toThrow(/CORS_ORIGINS/);
    }
    expect(parseEnv({ ...ok, CORS_ORIGINS: 'https://a.example.com, https://b.example.com:8443' }).CORS_ORIGINS).toHaveLength(2);
  });
});
