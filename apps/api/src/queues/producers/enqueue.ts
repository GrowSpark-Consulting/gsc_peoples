import type { JobsOptions } from 'bullmq';
import { ServiceUnavailableError } from '../../shared/errors';
import type { QueueName } from '../jobs/queue-names';
import { getQueue } from '../queue-factory';

/** Adds a job to a queue. Throws ServiceUnavailableError when Redis is not configured. */
export async function enqueue<T extends object>(
  queueName: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions,
) {
  const queue = getQueue(queueName);
  if (!queue) throw new ServiceUnavailableError('Background jobs are disabled (REDIS_URL not set)');
  return queue.add(jobName, data, options);
}
