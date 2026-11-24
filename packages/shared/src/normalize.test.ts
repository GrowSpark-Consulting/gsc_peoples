import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalize';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM \t')).toBe('jane.doe@example.com');
  });
  it('rejects blank input', () => {
    expect(() => normalizeEmail('   ')).toThrow();
    expect(() => normalizeEmail('')).toThrow();
  });
});
