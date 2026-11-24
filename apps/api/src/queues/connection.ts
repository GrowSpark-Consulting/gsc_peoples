import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../shared/utils/logger';

let connection: Redis | undefined;

export const isRedisConfigured = () => Boolean(env.REDIS_URL);

/**
 * Shared Redis connection for BullMQ and health checks.
 * Returns null when REDIS_URL is unset, so callers can degrade gracefully.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!connection) {
    // BullMQ requires maxRetriesPerRequest: null on blocking connections.
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  }
  return connection;
}

export async function closeRedis(): Promise<void> {
  if (!connection) return;
  await connection.quit().catch(() => connection?.disconnect());
  connection = undefined;
}
