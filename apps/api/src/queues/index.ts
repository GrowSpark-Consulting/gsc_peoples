import { logger } from '../shared/utils/logger';
import { closeRedis, isRedisConfigured } from './connection';
import { closeQueues } from './queue-factory';
import { closeWorkers } from './workers/worker-registry';

/** Called once at startup. Worker registrations for business jobs are added here later. */
export function startBackgroundJobs(): void {
  if (!isRedisConfigured()) {
    logger.warn('REDIS_URL not set: background jobs and outbound domain events are DISABLED');
    return;
  }
  // No workers yet.
}

/** Graceful shutdown: stop workers first, then queues, then the connection. */
export async function stopBackgroundJobs(): Promise<void> {
  await closeWorkers();
  await closeQueues();
  await closeRedis();
}
