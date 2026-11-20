import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryProjectionStore, type ProjectionRecord } from '@pi-console/core';
import { StreamHub } from './stream-hub.ts';
import { streamSequence } from './stream-sequence.ts';

class Store extends MemoryProjectionStore {
  writes = 0;
  fail = false;
  override save(records: readonly ProjectionRecord[]): void {
    if (this.fail) throw new Error('reservation failed');
    super.save(records);
    this.writes++;
  }
}

const hubFor = (store: Store, floor = 0, blockSize = 4) => new StreamHub({
  ...streamSequence(store, floor, blockSize), ringSize: 10, heartbeatMs: 60_000,
  maxBufferedBytes: 1024, snapshot: () => ({}),
});

test('zero-client publications use committed blocks, contiguous ids and a higher restart barrier', () => {
  const store = new Store();
  const first = hubFor(store, 20);
  try {
    const base = first.seq;
    for (let i = 0; i < 9; i++) {
      first.publish('job.updated', { id: i });
      assert.equal(first.seq, base + i + 1);
      assert.ok(store.load('$stream')!.position >= first.seq);
    }
    assert.equal(first.clients, 0);
    assert.equal(first.retained, 9);
    assert.equal(store.writes, 3);
    const bound = store.load('$stream')!.position;
    const restarted = hubFor(store);
    try { assert.ok(restarted.seq > bound); }
    finally { restarted.close(); }
  } finally { first.close(); }
});

test('reservation failure exposes no id or frame, and retry at exhaustion remains contiguous', () => {
  const store = new Store();
  const hub = hubFor(store, 0, 2);
  try {
    hub.publish('job.updated', {});
    hub.publish('job.updated', {});
    const seq = hub.seq;
    const bound = store.load('$stream')!.position;
    store.fail = true;
    assert.throws(() => hub.publish('job.updated', {}), /reservation failed/);
    assert.equal(hub.seq, seq);
    assert.equal(hub.retained, 2);
    assert.equal(store.load('$stream')!.position, bound);
    store.fail = false;
    hub.publish('job.updated', {});
    assert.equal(hub.seq, seq + 1);
    assert.equal(hub.retained, 3);
  } finally { hub.close(); }
  store.fail = true;
  assert.throws(() => streamSequence(store, 0, 2), /reservation failed/);
});

test('unsafe stream ranges are rejected before persistence', () => {
  const store = new Store();
  assert.throws(() => streamSequence(store, Number.MAX_SAFE_INTEGER), /Stream sequence exhausted/);
  assert.equal(store.writes, 0);
});
