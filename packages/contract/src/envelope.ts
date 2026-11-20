import { id, int, nullable, strict, time, type Schema } from './schema-dsl.ts';
import { validate } from './validate.ts';

/** Pointer from an event back to the source bytes (event-model section 1, `refs`). */
export interface SourceRef { file: string; offset: number; entryId: string | null }

export type Actor = 'system' | `user:${string}` | `agent:${string}`;

export interface EventEnvelope<Payload = unknown> {
  seq: number;
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  recordedAt: string;
  source: string;
  idempotencyKey: string;
  subject: string;
  actor: Actor;
  payload: Payload;
  refs: SourceRef | null;
}

/** What an adapter hands to the log; `seq` and `recordedAt` are assigned on append. */
export type NewEvent<Payload = unknown> = Omit<EventEnvelope<Payload>, 'seq' | 'recordedAt'>;

export const subjectKinds = ['session', 'lane', 'question', 'message', 'job', 'phase', 'issue', 'source', 'console'] as const;

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const subjectPattern = new RegExp(`^(${subjectKinds.join('|')}):.+$`);
const actorPattern = /^(system|user:.+|agent:.+)$/;

export const envelopeSchema: Schema = {
  $id: 'https://pi-console.invalid/events/envelope.json',
  ...strict({
    seq: int, id, type: id, version: { type: 'integer', minimum: 1 },
    occurredAt: time, recordedAt: time, source: id, idempotencyKey: id, subject: id, actor: id,
    payload: {}, refs: nullable(strict({ file: id, offset: int, entryId: nullable(id) })),
  }),
};

export type EnvelopeResult = { ok: true; event: EventEnvelope } | { ok: false; error: string };

/** Structural and format validation of a stored or received envelope. Does not look at the payload. */
export function validateEnvelope(value: unknown): EnvelopeResult {
  try {
    validate(value, envelopeSchema);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const event = value as EventEnvelope;
  if (!uuidV7.test(event.id)) return { ok: false, error: '$.id: expected UUID v7' };
  if (!subjectPattern.test(event.subject)) return { ok: false, error: '$.subject: expected <kind>:<id>' };
  if (!actorPattern.test(event.actor)) return { ok: false, error: '$.actor: expected system, user:<id> or agent:<id>' };
  return { ok: true, event };
}

/** The identity components of an idempotency key (event-model section 4). */
export interface IdempotencyParts {
  source: string;
  /** File identity (device+inode+birth) or another stable source identity. */
  identity: string;
  generation: number;
  /** Byte offset, or an entry id when the source has no stable offsets. */
  offset: number | string;
  type: string;
}

/**
 * Derives the unique key for an event. Parts are percent-encoded, so the `|` separator cannot
 * appear inside a part and two different tuples never collide.
 */
export function idempotencyKey(parts: IdempotencyParts): string {
  return [parts.source, parts.identity, parts.generation, parts.offset, parts.type]
    .map(part => encodeURIComponent(String(part)))
    .join('|');
}
