import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

const ORIGIN = 'http://localhost:3000';

describe('safeNextPath', () => {
  it('keeps same-origin paths, queries and hashes', () => {
    expect(safeNextPath('/employees', ORIGIN)).toBe('/employees');
    expect(safeNextPath('/employees?q=mia&page=2#top', ORIGIN)).toBe('/employees?q=mia&page=2#top');
  });

  it('falls back for missing values', () => {
    expect(safeNextPath(null, ORIGIN)).toBe('/dashboard');
    expect(safeNextPath('', ORIGIN)).toBe('/dashboard');
  });

  it('rejects absolute, protocol-relative, backslash and control-character redirects', () => {
    for (const bad of [
      'https://evil.example',
      'http://localhost:3000.evil.example/x',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      'javascript:alert(1)',
      'employees',
    ]) {
      expect(safeNextPath(bad, ORIGIN), bad).toBe('/dashboard');
    }
  });
});
