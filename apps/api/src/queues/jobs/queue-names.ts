/** Queue names. Business queues are added here by later tasks. */
export const QUEUE_NAMES = {
  domainEventsOutbound: 'domain-events-outbound',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
