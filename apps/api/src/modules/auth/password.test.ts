import { describe, expect, it } from 'vitest';
import { hashPassword, secureToken, tokenHash, verifyPassword } from './password';

describe('Phase 1 password and token primitives', () => {
  it('hashes passwords and verifies only the matching password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$/);
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('rejects malformed password encodings', () => {
    expect(verifyPassword('anything', 'plain$bad')).toBe(false);
    expect(verifyPassword('anything', 'bcrypt$one$two')).toBe(false);
  });

  it('creates long single-use style tokens and deterministic hashes', () => {
    const token = secureToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash(token)).toBe(tokenHash(token));
    expect(tokenHash(token)).not.toBe(token);
  });
});
