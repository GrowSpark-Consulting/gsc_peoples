import { Worker, type Processor, type WorkerOptions } from 'bullmq';
import { logger } from '../../shared/utils/logger';
import { getRedis } from '../connection';
import type { QueueName } from '../jobs/queue-names';

const workers: Worker[] = [];

/**
 * Registers a worker for a queue. Returns null when Redis is not configured.
 * Failure handling: every failed attempt is logged; once retries are exhausted the
 * job stays in BullMQ's failed set (see job-options) and is logged as exhausted.
 */
export function registerWorker<T = unknown, R = unknown>(
  queueName: QueueName,
  processor: Processor<T, R>,
  options: Omit<WorkerOptions, 'connection'> = {},
): Worker<T, R> | null {
  const connection = getRedis();
  if (!connection) {
    logger.warn({ queue: queueName }, 'Redis not configured; worker not started');
    return null;
  }
  const worker = new Worker<T, R>(queueName, processor, { connection, ...options });
  worker.on('failed', (job, err) => {
    const exhausted = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false;
    logger.error(
      { queue: queueName, jobId: job?.id, attemptsMade: job?.attemptsMade, exhausted, err },
      exhausted ? 'Job failed permanently' : 'Job attempt failed',
    );
  });
  worker.on('error', (err) => logger.error({ queue: queueName, err }, 'Worker error'));
  workers.push(worker);
  return worker;
}

export async function closeWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((w) => w.close()));
  workers.length = 0;
}
