import type { ProjectionStore } from '@pi-console/core';

const name = '$stream';

/**
 * A restart starts beyond the committed upper bound, since its in-memory replay ring was lost. A range is committed
 * before any of its ids can reach a client; process death may waste ids, but can never reuse one. Live ids remain
 * contiguous. Snapshot-only frames consume no ids and no writes.
 */
export function streamSequence(store: ProjectionStore, projectedPosition: number, blockSize = 256): { base: number; persist: (seq: number) => void } {
  if (!Number.isSafeInteger(blockSize) || blockSize < 1) throw new RangeError('Invalid stream reservation size');
  const previous = store.load(name);
  const base = Math.max(projectedPosition, previous ? previous.position + 1 : 0);
  let reserved = base;
  const reserve = (first: number): void => {
    const upper = first + blockSize - 1;
    if (!Number.isSafeInteger(upper) || upper < first) throw new Error('Stream sequence exhausted');
    store.save([{ name, version: 1, position: upper, state: null }]);
    reserved = upper;
  };
  reserve(base + 1);
  return {
    base,
    persist(seq) {
      if (!Number.isSafeInteger(seq)) throw new Error('Stream sequence exhausted');
      if (seq > reserved) reserve(seq);
    },
  };
}
