import type { Request, RequestHandler } from 'express';
import { AppError } from '../shared/errors';

export interface RateLimitOptions {
  /** Window length. */
  windowMs: number;
  /** Requests allowed per key and window. */
  max: number;
  /** What is counted. Default: the client IP (`req.ip`, which honours TRUST_PROXY_HOPS behind Render). */
  key?: (req: Request) => string;
  /** Clock override for tests. */
  now?: () => number;
  /** Paths (relative to the mount point) that are never limited, e.g. the health check. */
  skip?: (req: Request) => boolean;
  /**
   * Responses that are given back to the counter when they finish, e.g. 5xx: a request the server failed to handle
   * (database outage, timeout) must not use up the client's allowance. The hit is still counted while the request is
   * in flight, so concurrent requests cannot exceed `max`.
   */
  refund?: (statusCode: number) => boolean;
}

/**
 * Fixed-window, in-memory rate limiter. One API instance is the supported topology (see the Render doc), so a
 * process-local counter is exact; with several instances the effective limit is `max` per instance, which is
 * still a valid upper bound per instance. Expired entries are swept so memory stays bounded.
 * Responses carry `RateLimit-*` and `Retry-After` headers; exceeding the limit is HTTP 429 `RATE_LIMITED`.
 */
export function rateLimit(o: RateLimitOptions): RequestHandler & { reset(): void; size(): number } {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = o.now ?? Date.now;
  let lastSweep = now();

  const handler: RequestHandler = (req, res, next) => {
    if (o.skip?.(req)) return next();
    const t = now();
    if (t - lastSweep > o.windowMs) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      lastSweep = t;
    }
    const key = (o.key ?? ((r) => r.ip ?? 'unknown'))(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + o.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, o.max - entry.count);
    const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
    res.setHeader('RateLimit-Limit', String(o.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));
    if (entry.count > o.max) {
      res.setHeader('Retry-After', String(resetSeconds));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again later.'));
    }
    if (o.refund) {
      const counted = entry;
      res.once('finish', () => {
        // Only within the same window; an expired or swept entry is left alone.
        if (o.refund!(res.statusCode) && hits.get(key) === counted && counted.count > 0) counted.count -= 1;
      });
    }
    next();
  };
  return Object.assign(handler, { reset: () => hits.clear(), size: () => hits.size });
}
