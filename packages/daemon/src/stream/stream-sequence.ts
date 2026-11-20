import type { ProjectionStore } from '@pi-console/core';

/**
 * Reserve ids durably before exposing them. A restart consumes one id as a snapshot barrier: even the last
 * pre-restart id must refresh, since the in-memory replay ring is gone and catch-up may have changed the models.
 * The projected position is a floor for databases created before the independent stream counter existed.
 */
export function streamSequence(store: ProjectionStore, projectedPosition: number): { base: number; persist: (seq: number) => void } {
  const previous = store.load('$stream');
  const base = Math.max(projectedPosition, previous ? previous.position + 1 : 0);
  const persist = (seq: number): void => {
    if (!Number.isSafeInteger(seq)) throw new Error('Stream sequence exhausted');
    store.save([{ name: '$stream', version: 1, position: seq, state: null }]);
  };
  persist(base);
  return { base, persist };
}
