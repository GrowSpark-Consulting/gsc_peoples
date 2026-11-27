import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const dev = { NODE_ENV: 'development', AUTH_MODE: 'session', DATABASE_URL: 'postgresql://u:p@localhost:5432/hr_db?schema=hr' };

describe('identity document configuration', () => {
  it('is optional: without a key the API still starts (the identity endpoints answer 503)', () => {
    const e = parseEnv(dev);
    expect(e.IDENTITY_DOC_ENCRYPTION_KEY).toBeUndefined();
    expect(e.IDENTITY_DOC_ENCRYPTION_KEY_VERSION).toBe(1);
    expect(e.SUPABASE_IDENTITY_BUCKET).toBe('hr-identity-documents');
  });

  it('accepts a 32-byte base64 key and rejects anything else without echoing the value', () => {
    const key = crypto.randomBytes(32).toString('base64');
    expect(parseEnv({ ...dev, IDENTITY_DOC_ENCRYPTION_KEY: key }).IDENTITY_DOC_ENCRYPTION_KEY).toBe(key);
    const short = crypto.randomBytes(16).toString('base64');
    for (const bad of [short, 'not base64 !!', 'a'.repeat(44)]) {
      try {
        parseEnv({ ...dev, IDENTITY_DOC_ENCRYPTION_KEY: bad });
        expect.unreachable();
      } catch (e) {
        expect(String((e as Error).message)).toMatch(/IDENTITY_DOC_ENCRYPTION_KEY/);
        expect(String((e as Error).message)).not.toContain(bad);
      }
    }
  });

  it('the identity bucket must differ from the general documents bucket', () => {
    expect(() => parseEnv({ ...dev, SUPABASE_IDENTITY_BUCKET: 'hr-documents' })).toThrow(/SUPABASE_IDENTITY_BUCKET/);
  });
});
