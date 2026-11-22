// Integration tier: warm checkpoints + restored read models on the synthetic large tree, with session files present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drain, health, record, sessionCount, snapshot, warmFixture } from './performance-fixture.ts';

test('warm large-tree startup listens within 1 s and sends a populated snapshot within 3 s', { timeout: 300_000 }, async t => {
  const fixture = await warmFixture(t);
  const started = performance.now();
  const daemon = await fixture.start();
  const frame = await snapshot(daemon);
  assert.ok(frame.totals, 'warm snapshot includes collection totals');
  const firstSnapshotMs = performance.now() - started;
  const worst = await drain(daemon);
  const { eventLoop } = await health(daemon);
  record(`startup-warm: listen ${daemon.startupMs.toFixed(0)} ms, first snapshot ${firstSnapshotMs.toFixed(0)} ms, worst /health ${worst.toFixed(0)} ms, max event-loop delay ${eventLoop.max.toFixed(0)} ms, ${frame.sessions.length} sessions, ${frame.totals.jobs} jobs`);
  assert.equal(frame.sessions.filter(session => session.id.startsWith('volume-')).length, sessionCount);
  assert.ok(frame.totals.jobs >= 10_000, 'large read models were restored, not an empty startup');
  assert.ok(daemon.startupMs < 1_000, `warm listen ${daemon.startupMs} ms`);
  assert.ok(firstSnapshotMs < 3_000, `warm first snapshot ${firstSnapshotMs} ms`);
  assert.ok(worst < 200, `warm worst /health ${worst} ms`);
  await daemon.close();
});
