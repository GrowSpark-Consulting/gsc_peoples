import { describe, expect, it } from 'vitest';
import { demoModeEnabled } from './config';

describe('demoModeEnabled', () => {
  it('is never enabled in production, whatever the flag says', () => {
    for (const v of [undefined, '', 'demo', 'http', 'true']) {
      expect(demoModeEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_EMPLOYEES_ADAPTER: v })).toBe(false);
    }
  });

  it('must be chosen explicitly outside production (default is the real API)', () => {
    expect(demoModeEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(demoModeEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'http' })).toBe(false);
    expect(demoModeEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'demo' })).toBe(true);
    expect(demoModeEnabled({ NODE_ENV: 'test', NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'demo' })).toBe(true);
  });
});
