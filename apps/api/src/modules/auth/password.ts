import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual, type BinaryLike } from 'node:crypto';

/**
 * Password and token hashing (scrypt, Node defaults N=16384 r=8 p=1).
 *
 * Request handlers MUST use the `...Async` functions: the synchronous ones run scrypt on the event loop and block
 * every other request for tens of milliseconds each. The synchronous ones remain for offline tooling only (seeders,
 * provisioning scripts, test fixtures). Both produce byte-identical results: same parameters, same salt, same format.
 */

const PASSWORD_KEY_LENGTH = 64;
const TOKEN_KEY_LENGTH = 32;
const TOKEN_SALT = 'gsc-peoples-token-hash';

/** crypto.scrypt with the default cost parameters (identical to scryptSync without options), on the libuv thread pool. */
function scryptAsync(password: BinaryLike, salt: BinaryLike, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const encode = (salt: string, digest: Buffer) => `scrypt$${salt}$${digest.toString('hex')}`;

function decode(encoded: string): { salt: string; digest: Buffer } | undefined {
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return undefined;
  const [salt, encodedDigest] = [parts[1], parts[2]];
  if (!salt || !encodedDigest) return undefined;
  return { salt, digest: Buffer.from(encodedDigest, 'hex') };
}

const newSalt = () => randomBytes(16).toString('hex');

/** Offline tooling only (blocks the event loop). Use hashPasswordAsync in request handlers. */
export function hashPassword(password: string): string {
  const salt = newSalt();
  return encode(salt, scryptSync(password, salt, PASSWORD_KEY_LENGTH));
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = newSalt();
  return encode(salt, await scryptAsync(password, salt, PASSWORD_KEY_LENGTH));
}

/** Offline tooling only (blocks the event loop). Use verifyPasswordAsync in request handlers. */
export function verifyPassword(password: string, encoded: string): boolean {
  const parsed = decode(encoded);
  if (!parsed) return false;
  const candidate = scryptSync(password, parsed.salt, PASSWORD_KEY_LENGTH);
  return parsed.digest.length === candidate.length && timingSafeEqual(parsed.digest, candidate);
}

export async function verifyPasswordAsync(password: string, encoded: string): Promise<boolean> {
  const parsed = decode(encoded);
  if (!parsed) return false;
  const candidate = await scryptAsync(password, parsed.salt, PASSWORD_KEY_LENGTH);
  return parsed.digest.length === candidate.length && timingSafeEqual(parsed.digest, candidate);
}

export function secureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Offline tooling only (blocks the event loop). Use tokenHashAsync in request handlers. */
export function tokenHash(token: string): string {
  return scryptSync(token, TOKEN_SALT, TOKEN_KEY_LENGTH).toString('hex');
}

export async function tokenHashAsync(token: string): Promise<string> {
  return (await scryptAsync(token, TOKEN_SALT, TOKEN_KEY_LENGTH)).toString('hex');
}

/**
 * Memoised `tokenHashAsync` for the tokens presented on EVERY authenticated request (session and CSRF cookies).
 * scrypt costs ~100 ms of CPU per call and the libuv pool runs only four at once, so hashing the same cookie again on
 * each request made scrypt the single largest cost of the API, and parallel page requests queued behind each other.
 *
 * Security: the result is identical to `tokenHashAsync` (the stored hash format is unchanged and no session is
 * invalidated), and the database row is still read on every request, so revocation, expiry and idle timeout keep
 * applying immediately. The cache is keyed by a SHA-256 of the token, never the raw token, holds entries for at most
 * `TOKEN_HASH_CACHE_TTL_MS`, and is bounded in size (oldest first).
 */
const TOKEN_HASH_CACHE_MAX = 5_000;
export const TOKEN_HASH_CACHE_TTL_MS = 15 * 60_000;
const tokenHashCache = new Map<string, { hash: Promise<string>; expiresAt: number }>();

export function cachedTokenHashAsync(token: string, now: number = Date.now()): Promise<string> {
  const key = createHash('sha256').update(token).digest('hex');
  const hit = tokenHashCache.get(key);
  if (hit && hit.expiresAt > now) return hit.hash;
  if (hit) tokenHashCache.delete(key);
  const hash = tokenHashAsync(token);
  tokenHashCache.set(key, { hash, expiresAt: now + TOKEN_HASH_CACHE_TTL_MS });
  // A failed hash must not be remembered.
  hash.catch(() => tokenHashCache.delete(key));
  if (tokenHashCache.size > TOKEN_HASH_CACHE_MAX) {
    const oldest = tokenHashCache.keys().next().value;
    if (oldest !== undefined) tokenHashCache.delete(oldest);
  }
  return hash;
}

/** Test seam. */
export const clearTokenHashCache = () => tokenHashCache.clear();
