import { definitionOf, payloadValid } from './catalogue.ts';
import type { EventEnvelope } from './envelope.ts';

/** Pure payload migration from one version to the next. */
export type Upcaster = (payload: unknown) => unknown;

/**
 * Upcasters by event type, keyed by the version they upgrade FROM (to version + 1).
 * Empty in M1: every catalogue type is at version 1. Stubs exist so the projector's decode path is final.
 */
export const upcasters: Record<string, Record<number, Upcaster | undefined> | undefined> = {};

export type SkipReason = 'unknown-type' | 'unknown-version' | 'invalid-payload';
export type DecodeResult = { kind: 'ok'; event: EventEnvelope } | { kind: 'skipped'; reason: SkipReason; detail: string };

/**
 * Brings a stored event to the current catalogue version. Events the console does not understand are
 * skipped (the projector counts them), never fatal: a newer daemon may have written them.
 */
export function decode(event: EventEnvelope): DecodeResult {
  const definition = definitionOf(event.type);
  if (!definition) return { kind: 'skipped', reason: 'unknown-type', detail: event.type };
  if (event.version > definition.version || event.version < 1) {
    return { kind: 'skipped', reason: 'unknown-version', detail: `${event.type} v${event.version}` };
  }
  let payload = event.payload;
  for (let version = event.version; version < definition.version; version++) {
    const step = upcasters[event.type]?.[version];
    if (!step) return { kind: 'skipped', reason: 'unknown-version', detail: `${event.type} v${version} has no upcaster` };
    payload = step(payload);
  }
  const problem = payloadValid(definition, payload);
  if (problem) return { kind: 'skipped', reason: 'invalid-payload', detail: `${event.type}: ${problem}` };
  return { kind: 'ok', event: { ...event, version: definition.version, payload } };
}
