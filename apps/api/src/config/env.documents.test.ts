import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const dev = { NODE_ENV: 'development', AUTH_MODE: 'session', DATABASE_URL: 'postgresql://u:p@localhost:5432/hr_db?schema=hr' };
const prod = { ...dev, NODE_ENV: 'production', CORS_ORIGINS: 'https://hr.example.com' };
const supabase = { DOCUMENT_STORAGE_DRIVER: 'supabase', SUPABASE_STORAGE_URL: 'https://abc.supabase.co', SUPABASE_STORAGE_SERVICE_KEY: 'k' };

describe('document storage configuration', () => {
  it('defaults to the local driver and the private bucket name in development', () => {
    const e = parseEnv(dev);
    expect(e.DOCUMENT_STORAGE_DRIVER).toBe('local');
    expect(e.SUPABASE_STORAGE_BUCKET).toBe('hr-documents');
  });

  it('the supabase driver needs both the URL and the service key (each error names the variable)', () => {
    expect(() => parseEnv({ ...dev, DOCUMENT_STORAGE_DRIVER: 'supabase' })).toThrow(/SUPABASE_STORAGE_URL[\s\S]*SUPABASE_STORAGE_SERVICE_KEY|SUPABASE_STORAGE_SERVICE_KEY[\s\S]*SUPABASE_STORAGE_URL/);
    expect(() => parseEnv({ ...dev, ...supabase, SUPABASE_STORAGE_SERVICE_KEY: '' })).toThrow(/SUPABASE_STORAGE_SERVICE_KEY/);
    expect(() => parseEnv({ ...dev, ...supabase, SUPABASE_STORAGE_URL: 'not a url' })).toThrow(/SUPABASE_STORAGE_URL/);
    expect(parseEnv({ ...dev, ...supabase }).DOCUMENT_STORAGE_DRIVER).toBe('supabase');
  });

  it('rejects unknown drivers and bucket names Supabase would refuse', () => {
    expect(() => parseEnv({ ...dev, DOCUMENT_STORAGE_DRIVER: 's3' })).toThrow(/DOCUMENT_STORAGE_DRIVER/);
    expect(() => parseEnv({ ...dev, ...supabase, SUPABASE_STORAGE_BUCKET: 'ab' })).toThrow(/SUPABASE_STORAGE_BUCKET/);
    expect(() => parseEnv({ ...dev, ...supabase, SUPABASE_STORAGE_BUCKET: 'x'.repeat(64) })).toThrow(/SUPABASE_STORAGE_BUCKET/);
  });

  it('production never uses the local disk, and a production config with the supabase driver is accepted', () => {
    expect(() => parseEnv(prod)).toThrow(/DOCUMENT_STORAGE_DRIVER=supabase is required/);
    expect(() => parseEnv({ ...prod, DOCUMENT_STORAGE_DRIVER: 'local' })).toThrow(/DOCUMENT_STORAGE_DRIVER=supabase is required/);
    expect(parseEnv({ ...prod, ...supabase }).DOCUMENT_STORAGE_DRIVER).toBe('supabase');
  });

  it('the database target and the storage target are independent: local DB never reads storage variables', () => {
    const e = parseEnv({ ...dev, SUPABASE_STORAGE_SERVICE_KEY: 'k' });
    expect(e.DB_TARGET).toBe('local');
    expect(e.DOCUMENT_STORAGE_DRIVER).toBe('local');
  });
});
