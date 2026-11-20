import { randomBytes } from 'node:crypto';
import { definitionOf, idempotencyKey, payloadValid, type NewEvent, type SourceCheckpoint } from '@pi-console/contract';
import { redactValue, type Scanner } from './redact.ts';

export interface Fact { type: string; subject: string; payload: Record<string, unknown>; occurredAt?: string; entryId?: string }
export type Mapper = (record: Record<string, unknown>) => readonly Fact[];
interface MappingContext { checkpoint: SourceCheckpoint; mapper: Mapper; scanner?: Scanner }

function sourceRecord(value: unknown): Record<string, unknown> {
  if (value === null) throw new Error('object required');
  if (typeof value !== 'object') throw new Error('object required');
  if (Array.isArray(value)) throw new Error('object required');
  return value as Record<string, unknown>;
}

/** UUIDv7 layout; chronological ordering comes from the EventLog seq, not random id bits. */
function eventId(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function warning(checkpoint: SourceCheckpoint, offset: number, detail: string): NewEvent {
  return envelope(checkpoint, offset, {
    type: 'SourceSchemaUnknown', subject: `source:${checkpoint.source}`,
    payload: { source: checkpoint.source, identity: checkpoint.identity, detail },
  });
}

function envelope(checkpoint: SourceCheckpoint, offset: number, fact: Fact): NewEvent {
  return {
    id: eventId(), type: fact.type, version: 1, occurredAt: fact.occurredAt ?? new Date(checkpoint.mtimeMs).toISOString(),
    source: checkpoint.source, subject: fact.subject, actor: 'system', payload: fact.payload,
    idempotencyKey: idempotencyKey({ ...checkpoint, offset, type: fact.type }),
    refs: { file: checkpoint.path, offset, entryId: fact.entryId ?? null },
  };
}

/** Invalid input is never embedded in diagnostic text, including mapper exceptions. */
export function mapLine(line: string, offset: number, context: MappingContext): NewEvent[] {
  const { checkpoint, mapper, scanner } = context;
  try {
    const facts = mapper(sourceRecord(JSON.parse(line)));
    return facts.map(fact => safeEvent(fact, checkpoint, offset, scanner));
  } catch {
    return [warning(checkpoint, offset, 'Unrecognised source record; body withheld')];
  }
}

function safeEvent(fact: Fact, checkpoint: SourceCheckpoint, offset: number, scanner?: Scanner): NewEvent {
  const safe = redactValue(fact, scanner) as Fact;
  const definition = definitionOf(safe.type);
  if (!definition) throw new Error('Unknown event mapping');
  if (!definition.sources.includes(checkpoint.source)) throw new Error('Invalid event source');
  if (payloadValid(definition, safe.payload)) throw new Error('Invalid event payload');
  return envelope(checkpoint, offset, safe);
}
