import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://hr_app:x@localhost:5432/hr_db?schema=hr' };

describe('platform (Render) configuration', () => {
  it('uses the platform PORT when API_PORT is unset, API_PORT wins when set', () => {
    expect(parseEnv({ ...base, PORT: '10000' }).API_PORT).toBe(10000);
    expect(parseEnv({ ...base, PORT: '10000', API_PORT: '4100' }).API_PORT).toBe(4100);
    expect(parseEnv(base).API_PORT).toBe(4000);
  });
  it('binds 0.0.0.0 by default and keeps COOKIE_DOMAIN optional', () => {
    const e = parseEnv(base);
    expect(e.HOST).toBe('0.0.0.0');
    expect(e.COOKIE_DOMAIN).toBeUndefined();
    expect(parseEnv({ ...base, COOKIE_DOMAIN: '.example.com' }).COOKIE_DOMAIN).toBe('.example.com');
  });
});
