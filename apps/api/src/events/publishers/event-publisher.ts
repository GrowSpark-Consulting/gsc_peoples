import { QUEUE_NAMES } from '../../queues/jobs/queue-names';
import { enqueue } from '../../queues/producers/enqueue';
import { isRedisConfigured } from '../../queues/connection';
import { logger } from '../../shared/utils/logger';
import type { DomainEventEnvelope } from '../contracts';

export interface EventPublisher {
  publish(event: DomainEventEnvelope): Promise<void>;
}

/** Publishes events onto the outbound BullMQ queue (retried per job-options). */
export class QueueEventPublisher implements EventPublisher {
  async publish(event: DomainEventEnvelope): Promise<void> {
    await enqueue(QUEUE_NAMES.domainEventsOutbound, event.type, event, { jobId: event.id });
  }
}

/** Used when Redis is unavailable: events are dropped with a warning, never silently. */
export class NoopEventPublisher implements EventPublisher {
  publish(event: DomainEventEnvelope): Promise<void> {
    logger.warn(
      { eventType: event.type, eventId: event.id },
      'Domain event dropped: Redis disabled',
    );
    return Promise.resolve();
  }
}

export const createEventPublisher = (): EventPublisher =>
  isRedisConfigured() ? new QueueEventPublisher() : new NoopEventPublisher();
