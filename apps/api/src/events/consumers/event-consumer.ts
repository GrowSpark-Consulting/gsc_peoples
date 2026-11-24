import type { DomainEventEnvelope } from '../contracts';

export type EventHandler = (event: DomainEventEnvelope) => Promise<void>;

/** Routes inbound events to handlers by event type. Handlers must be idempotent. */
export class EventConsumerRegistry {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(type: string, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  async dispatch(event: DomainEventEnvelope): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) await handler(event);
  }
}
