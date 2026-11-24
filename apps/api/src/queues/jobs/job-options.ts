import type { DefaultJobOptions } from 'bullmq';

/** Retry policy applied to every queue unless overridden per job. */
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  // Keep failed jobs for inspection / manual replay.
  removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
};
