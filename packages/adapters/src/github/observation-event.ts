import { createHash, randomBytes } from 'node:crypto';
import { definitionOf, idempotencyKey, parseTargetKey, payloadValid, type NewEvent } from '@pi-console/contract';
import { redactValue, type Scanner } from '../tailing/redact.ts';

export interface LinkObservationFact {
  questionId: string; revision: number; target: string; kind: 'issue' | 'pull-request' | null;
  state: 'open' | 'closed' | 'merged' | 'unknown'; closedAt: string | null; fetchedAt: string;
}

function uuidV7(at: number): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(at, 0, 6);
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const unchangedAndValid = (definition: NonNullable<ReturnType<typeof definitionOf>>, payload: object, safe: Record<string, unknown>): boolean =>
  JSON.stringify(safe) === JSON.stringify(payload) && !payloadValid(definition, safe);

/**
 * The event for one observation, or null when it cannot be recorded safely: invalid target or payload, or a redaction
 * pass that would change any value (an altered identity must never be matched to a different target). Identity is the
 * question, link-set revision, target and fetch time, so re-emitting a cached observation is the same event, and a
 * relinked association is a new one. No file checkpoint is invented; `refs` is null.
 */
export function observationEvent(fact: LinkObservationFact, scanner?: Scanner): NewEvent | null {
  const fetched = Date.parse(fact.fetchedAt);
  if (!parseTargetKey(fact.target) || Number.isNaN(fetched)) return null;
  const payload = { ...fact, source: 'github-gh' };
  const safe = redactValue(payload, scanner) as Record<string, unknown>;
  const definition = definitionOf('QuestionLinkStateObserved');
  if (!definition || !unchangedAndValid(definition, payload, safe)) return null;
  const identity = createHash('sha256').update(`${fact.questionId}\n${String(fact.revision)}\n${fact.target}`).digest('hex');
  return {
    id: uuidV7(fetched), type: definition.type, version: 1, occurredAt: fact.fetchedAt, source: 'github-closures', subject: `question:${fact.questionId}`, actor: 'system',
    payload: safe, refs: null, idempotencyKey: idempotencyKey({ source: 'github-closures', identity, generation: 0, offset: fetched, type: definition.type }),
  };
}
