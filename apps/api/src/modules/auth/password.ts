import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [salt, encodedDigest] = [parts[1], parts[2]];
  if (!salt || !encodedDigest) return false;
  const digest = Buffer.from(encodedDigest, 'hex');
  const candidate = scryptSync(password, salt, 64);
  return digest.length === candidate.length && timingSafeEqual(digest, candidate);
}

export function secureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function tokenHash(token: string): string {
  return scryptSync(token, 'gsc-peoples-token-hash', 32).toString('hex');
}
