import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryRefreshController } from './memory-refresh-controller.ts';

const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
function rig() {
  const timers = new Map<number, () => void>();
  let key = 0;
  const reads: string[] = [];
  const readiness: string[] = [];
  let block: Promise<void> | undefined;
  const controller = new MemoryRefreshController(async id => { reads.push(id); await block; }, async id => { readiness.push(id); }, {
    set: (callback, ms) => { assert.equal(ms, 350); timers.set(++key, callback); return key; },
    clear: token => { timers.delete(token as number); },
  });
  return { controller, reads, readiness, timers,
    tick() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    hold() { let release!: () => void; block = new Promise<void>(resolve => { release = resolve; }); return () => { block = undefined; release(); }; },
  };
}

test('hidden invalidations are free; visible waves debounce, coalesce and preserve per-session visibility', async () => {
  const r = rig();
  r.controller.invalidate('s1'); r.controller.invalidateVisible();
  assert.deepEqual(r.reads, []);
  const close = r.controller.watch('s1');
  await settle();
  assert.deepEqual(r.readiness, ['s1']);
  for (let n = 0; n < 20; n++) { r.controller.invalidate('s1'); r.controller.invalidate('s2'); }
  assert.equal(r.timers.size, 1);
  assert.deepEqual(r.reads, ['s1']);
  r.tick(); await settle();
  assert.deepEqual(r.reads, ['s1', 's1']);
  assert.deepEqual(r.readiness, ['s1', 's1']);
  r.controller.invalidateVisible(); close();
  assert.equal(r.timers.size, 0);
  r.controller.watch('s1'); await settle();
  assert.equal(r.reads.length, 3, 'reopening always reads');
  r.controller.dispose();
});

test('invalidation during an in-flight read schedules one trailing read, never a concurrent read', async () => {
  const r = rig(); const release = r.hold();
  r.controller.watch('s1');
  for (let n = 0; n < 100; n++) r.controller.invalidate('s1');
  assert.deepEqual(r.reads, ['s1']);
  release(); await settle();
  assert.equal(r.timers.size, 1);
  r.tick(); await settle();
  assert.deepEqual(r.reads, ['s1', 's1']);
  assert.deepEqual(r.readiness, ['s1', 's1']);
  r.controller.dispose();
});

test('forced completion while hidden is immediate, serialized, canonical-only and never dispatches readiness', async () => {
  const r = rig(); const release = r.hold();
  let completed = false;
  const first = r.controller.refresh('s1');
  const second = r.controller.refresh('s1').then(() => { completed = true; });
  await settle();
  assert.equal(completed, false);
  assert.deepEqual(r.reads, ['s1']);
  release(); await first; await second;
  assert.deepEqual(r.reads, ['s1', 's1']);
  assert.deepEqual(r.readiness, []);
  assert.equal(r.timers.size, 0);
  r.controller.dispose();
});

test('unwatch cancels automatic trailing work; dispose cancels timers and in-flight followups', async () => {
  const r = rig(); const release = r.hold();
  const close = r.controller.watch('s1');
  r.controller.invalidate('s1'); close(); close();
  release(); await settle(); r.tick(); await settle();
  assert.deepEqual(r.reads, ['s1']);
  r.controller.watch('s1'); await settle();
  r.controller.invalidateVisible();
  assert.equal(r.timers.size, 1);
  r.controller.dispose(); r.tick(); await settle();
  await r.controller.refresh('s1');
  assert.deepEqual(r.reads, ['s1', 's1']);
});

test('a failed read preserves the controller lifecycle and retries on reopen or later invalidation', async () => {
  let calls = 0;
  const controller = new MemoryRefreshController(() => { calls++; return Promise.reject(new Error('offline')); }, () => Promise.resolve());
  const close = controller.watch('s1'); await settle(); close();
  controller.watch('s1'); await settle();
  assert.equal(calls, 2);
  controller.dispose();
});
