// Integration tier: absolute idle RSS in a fresh warm daemon process, not RSS growth or the fixture builder's RSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drain, health, record, sessionCount, snapshot, wait, warmFixture } from './performance-fixture.ts';

const mebibyte = 1024 * 1024;

test('idle large-tree daemon stays within 250 MiB RSS after drain', { timeout: 300_000 }, async t => {
  const fixture = await warmFixture(t);
  const daemon = await fixture.start();
  await drain(daemon);
  const frame = await snapshot(daemon);
  assert.ok(frame.totals, 'idle snapshot includes collection totals');
  assert.equal(frame.sessions.filter(session => session.id.startsWith('volume-')).length, sessionCount);
  assert.ok(frame.totals.jobs >= 10_000, 'the large read models must remain live');
  await wait(3_000);
  const samples: number[] = [];
  let heapUsed = 0;
  for (let i = 0; i < 7; i++) {
    const state = await health(daemon);
    assert.ok(state.backfill.complete);
    assert.equal(state.projection.queueDepth, 0, 'sample only after projection and delta drain');
    assert.ok(state.sources.every(source => source.lagBytes === 0));
    samples.push(state.memory.rssBytes);
    heapUsed = state.memory.heapUsedBytes;
    await wait(250);
  }
  // A median tolerates a transient sample without raising the absolute target or subtracting a runtime baseline.
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  record(`idle-memory: median RSS ${(median / mebibyte).toFixed(1)} MiB, range ${(samples[0] / mebibyte).toFixed(1)}–${((samples.at(-1) ?? 0) / mebibyte).toFixed(1)} MiB, heapUsed ${(heapUsed / mebibyte).toFixed(1)} MiB`);
  assert.ok(median <= 250 * mebibyte, `idle RSS ${median / mebibyte} MiB exceeds 250 MiB`);
  await daemon.close();
});
