import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createIdentityCipher, identityAad, IdentityCipherError } from './identity-crypto';

const key = crypto.randomBytes(32).toString('base64');
const aad = identityAad('company-a', 'employee-1', 'PAN');

describe('identity number encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const c = createIdentityCipher(key);
    const env = c.encrypt('ABCPE1234F', aad);
    expect(env).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(env).not.toContain('ABCPE1234F');
    expect(env).not.toContain('1234');
    expect(c.decrypt(env, aad)).toBe('ABCPE1234F');
  });

  it('uses a fresh IV per encryption', () => {
    const c = createIdentityCipher(key);
    expect(c.encrypt('ABCPE1234F', aad)).not.toBe(c.encrypt('ABCPE1234F', aad));
  });

  it('fails when the ciphertext is moved to another tenant, employee or type, or tampered with', () => {
    const c = createIdentityCipher(key);
    const env = c.encrypt('ABCPE1234F', aad);
    expect(() => c.decrypt(env, identityAad('company-b', 'employee-1', 'PAN'))).toThrow(IdentityCipherError);
    expect(() => c.decrypt(env, identityAad('company-a', 'employee-2', 'PAN'))).toThrow(IdentityCipherError);
    expect(() => c.decrypt(env, identityAad('company-a', 'employee-1', 'AADHAAR'))).toThrow(IdentityCipherError);
    const parts = env.split(':');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => c.decrypt([parts[0], parts[1], parts[2], flipped.toString('base64')].join(':'), aad)).toThrow(IdentityCipherError);
  });

  it('fails with a different key or key version, and the error never contains the plaintext', () => {
    const env = createIdentityCipher(key).encrypt('ABCPE1234F', aad);
    const other = createIdentityCipher(crypto.randomBytes(32).toString('base64'));
    try {
      other.decrypt(env, aad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(IdentityCipherError);
      expect(String((e as Error).message)).not.toContain('ABCPE');
    }
    expect(() => createIdentityCipher(key, 2).decrypt(env, aad)).toThrow(/key version/);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => createIdentityCipher(crypto.randomBytes(16).toString('base64'))).toThrow(IdentityCipherError);
  });
});
