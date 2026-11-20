import { idempotencyKey, type NewEvent, type SourceRef } from '@pi-console/contract';

/** Deterministic UUID v7 for specs: the same `n` always gives the same id. */
export function testId(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `01900000-0000-7000-8000-${hex}`;
}

export interface TestEventOptions {
  occurredAt?: string;
  source?: string;
  subject?: string;
  refs?: SourceRef | null;
}

/** Builds a valid `NewEvent` whose identity is derived from `n` (so re-appending it is a duplicate). */
export function testEvent(n: number, type: string, payload: unknown, options: TestEventOptions = {}): NewEvent {
  const source = options.source ?? 'session-jsonl';
  return {
    id: testId(n), type, version: 1,
    occurredAt: options.occurredAt ?? new Date(Date.UTC(2026, 10, 20, 8, 0, 0) + n * 1000).toISOString(),
    source, idempotencyKey: idempotencyKey({ source, identity: 'spec', generation: 0, offset: n, type }),
    subject: options.subject ?? 'console:spec', actor: 'system', payload, refs: options.refs ?? null,
  };
}
