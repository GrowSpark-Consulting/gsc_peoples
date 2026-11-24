import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://hr_app:x@localhost:5432/hr_db?schema=hr' };

describe('DB_TARGET', () => {
  it('defaults to local and ignores SUPABASE_* variables', () => {
    const e = parseEnv({ ...base, SUPABASE_DATABASE_URL: 'postgresql://hr_app:y@pooler/postgres' });
    expect(e.DB_TARGET).toBe('local');
    expect(e.DATABASE_URL).toBe(base.DATABASE_URL);
  });
  it('supabase target uses SUPABASE_DATABASE_URL and requires the CA path', () => {
    const sb = { ...base, DB_TARGET: 'supabase', SUPABASE_DATABASE_URL: 'postgresql://hr_app.ref:y@pooler/postgres?schema=hr' };
    expect(() => parseEnv(sb)).toThrow(/SUPABASE_CA_CERT_PATH/);
    const e = parseEnv({ ...sb, SUPABASE_CA_CERT_PATH: 'ca.crt' });
    expect(new URL(e.DATABASE_URL as string).searchParams.get('schema')).toBe('hr');
    expect(new URL(e.DATABASE_URL as string).username).toBe('hr_app.ref');
    const noSchema = parseEnv({ ...sb, SUPABASE_DATABASE_URL: 'postgresql://hr_app.ref:y@pooler/postgres', SUPABASE_CA_CERT_PATH: 'ca.crt' });
    expect(new URL(noSchema.DATABASE_URL as string).searchParams.get('schema')).toBe('hr');
  });
  it('rejects unknown targets', () => {
    expect(() => parseEnv({ ...base, DB_TARGET: 'prod' })).toThrow();
  });
});
