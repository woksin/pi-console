import type { EventEnvelope, MemoryItem } from '@pi-console/contract';
import type { ConsoleQueries } from '@pi-console/core';

const memoryEvents = new Set(['MemoryItemRecorded', 'MemoryItemConfirmed', 'MemoryItemRetired', 'MemoryMessageRecorded', 'MemoryMessageClassified', 'SessionStarted']);

/** Reuse detached state on ordinary transcript/heartbeat batches. */
export const memoryMayChange = (events: readonly EventEnvelope[]): boolean => events.some(event => memoryEvents.has(event.type));

/** Canonical queries own association, status and withholding. Never put these fingerprints on the stream. */
export function memoryState(queries: ConsoleQueries): Map<string, string> {
  const items = new Map<string, MemoryItem[]>();
  for (const item of queries.memoryItems()) {
    if (item.sessionId === null) continue;
    const group = items.get(item.sessionId) ?? [];
    group.push(item);
    items.set(item.sessionId, group);
  }
  return new Map(queries.sessions().map(session => [session.id, JSON.stringify([queries.sessionMemory(session.id), items.get(session.id) ?? []])]));
}

/** Handoff files are read on demand, so a reset must also refresh the visible panel. */
export function changedMemorySessions(before: Map<string, string>, after: Map<string, string>, events: readonly EventEnvelope[]): Set<string> {
  const changed = new Set(events.filter(event => event.type === 'ResetOccurred').map(event => (event.payload as { sessionId: string }).sessionId));
  for (const [id, fingerprint] of after) if (before.get(id) !== fingerprint) changed.add(id);
  return changed;
}
