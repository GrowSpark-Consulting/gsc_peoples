import { z } from 'zod';

/**
 * Envelope shared by every domain event exchanged between platform apps.
 * Concrete event types are added to `DomainEventMap` as they are agreed with
 * the Project and Sales apps. None exist yet.
 */
export const domainEventEnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().min(1),
  companyId: z.string().min(1),
  occurredAt: z.string().datetime(),
  source: z.string().min(1),
  correlationId: z.string().optional(),
  payload: z.unknown(),
});

export type DomainEventEnvelope<TType extends string = string, TPayload = unknown> = Omit<
  z.infer<typeof domainEventEnvelopeSchema>,
  'type' | 'payload'
> & { type: TType; payload: TPayload };

/** Registry of event type -> payload. Extend via declaration as events are defined. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DomainEventMap {}

export type DomainEventType = keyof DomainEventMap & string;

export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  [K in T]: DomainEventEnvelope<K, DomainEventMap[K]>;
}[T];
