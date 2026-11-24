import { Queue } from 'bullmq';
import { getRedis } from './connection';
import { defaultJobOptions } from './jobs/job-options';
import type { QueueName } from './jobs/queue-names';

const queues = new Map<QueueName, Queue>();

/** Returns the queue, or null when Redis is not configured (background jobs disabled). */
export function getQueue(name: QueueName): Queue | null {
  const connection = getRedis();
  if (!connection) return null;
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection, defaultJobOptions });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  queues.clear();
}
