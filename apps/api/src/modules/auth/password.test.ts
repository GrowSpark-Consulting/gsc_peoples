import { describe, expect, it } from 'vitest';
import { hashPassword, hashPasswordAsync, secureToken, tokenHash, tokenHashAsync, verifyPassword, verifyPasswordAsync } from './password';

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

/**
 * Asynchronous scrypt (request handlers) must be byte-compatible with the synchronous version that produced every
 * password hash and session/token hash already stored. The fixed vectors below were generated with the original
 * implementation (`scryptSync(password, salt, 64)` / `scryptSync(token, 'gsc-peoples-token-hash', 32)`).
 */
describe('async password and token hashing (compatibility with stored hashes)', () => {
  const STORED_HASH =
    'scrypt$00112233445566778899aabbccddeeff$5699cfee2c5c280e66678242092f368ce88ff05305af2c75a9e629d473deb2165b3797e0e31ec3cda30414573befb697f928384c38b187e8c176107e5be20f01';
  const STORED_TOKEN_HASH = '98416be4c93f9f58466695d62f580890c45c1f3e5df7b760c3f16d006ee1d3d2';

  it('an existing stored password hash verifies with both the sync and the async function', async () => {
    expect(verifyPassword('correct horse battery staple', STORED_HASH)).toBe(true);
    expect(await verifyPasswordAsync('correct horse battery staple', STORED_HASH)).toBe(true);
    expect(await verifyPasswordAsync('correct horse battery stapler', STORED_HASH)).toBe(false);
  });

  it('existing session/token hashes are reproduced exactly (sessions stay valid)', async () => {
    expect(tokenHash('fixed-session-token-value')).toBe(STORED_TOKEN_HASH);
    expect(await tokenHashAsync('fixed-session-token-value')).toBe(STORED_TOKEN_HASH);
    const token = secureToken();
    expect(await tokenHashAsync(token)).toBe(tokenHash(token));
  });

  it('hashes are interchangeable in both directions and keep the scrypt$<32-hex salt>$<128-hex digest> format', async () => {
    const asyncHash = await hashPasswordAsync('another password 1');
    expect(asyncHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(verifyPassword('another password 1', asyncHash)).toBe(true);
    expect(await verifyPasswordAsync('another password 1', hashPassword('another password 1'))).toBe(true);
    expect(await verifyPasswordAsync('another password 2', asyncHash)).toBe(false);
  });

  it('rejects malformed encodings without throwing', async () => {
    for (const bad of ['plain$bad', 'bcrypt$one$two', 'scrypt$$', 'scrypt$aa$', '', 'scrypt$00$zz']) {
      expect(await verifyPasswordAsync('anything', bad)).toBe(false);
    }
  });

  it('does not block the event loop: timers keep firing while several verifications run', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      await Promise.all(Array.from({ length: 8 }, () => verifyPasswordAsync('correct horse battery staple', STORED_HASH)));
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });
});
