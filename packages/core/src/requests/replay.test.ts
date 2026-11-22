import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { canonicalJson } from '../projector/canonical.ts';
import { Projector } from '../projector/projector.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { requestDerivation } from './derivation.ts';
import type { DerivationState, SessionRecord } from './model.ts';
import { pairSession } from './pairing.ts';
import { mixedRequestEvents, volumeRequestEvents } from './replay-fixture.ts';
import { SqliteRequestSessions } from './sqlite-sessions.ts';

// SHA-256 of canonical request output after EVERY prefix, captured from origin/main 70e2c72 before the optimization.
const originalOutput = [
  '40e43a79bcbe7e223dda113e8d593e4e2b3e4ab481d91ea0cdf676145ac582dc',
  '32d2b43c805091d87c2ef45ca19f065eb9091aadaaaa6d9850e792a2858e5f1e',
  '3d93df6c871a56e787393d4a2628122b5188dd508630eaa694f45d42c6ae9d34',
];

test('mixed request output equals the original derivation at every prefix, live and after SQL restore', async () => {
  const events = mixedRequestEvents();
  const orders = [events, events.toReversed(), [...events.filter((_, i) => i % 2), ...events.filter((_, i) => !(i % 2))]];
  for (const [index, order] of orders.entries()) {
    const live = requestDerivation.initial();
    const liveHash = createHash('sha256');
    const restoredHash = createHash('sha256');
    const log = new SqliteEventLog(':memory:');
    const store = new SqliteProjectionStore(':memory:');
    try {
      for (const event of order) {
        requestDerivation.apply(live, event);
        liveHash.update(canonicalJson(live.requests));
        await log.append([event]);
        const restored = new Projector(log, [requestDerivation], store);
        await restored.catchUp();
        restoredHash.update(canonicalJson((restored.state('requests') as DerivationState).requests));
        assert.ok(Object.values(restored.skipped.counts).every(count => count === 0));
        // Version-4 snapshots/legacy rows contained complete arrays. They must still accept incremental events.
        if (event.seq % 5 === 0) store.save([{ name: 'requests', version: requestDerivation.version, position: restored.position, state: restored.state('requests') }]);
      }
      assert.equal(liveHash.digest('hex'), originalOutput[index], `live order ${index}`);
      assert.equal(restoredHash.digest('hex'), originalOutput[index], `restored order ${index}`);
    } finally { store.close(); log.close(); }
  }
});

/** The volume fixture has no explicit answers/interruptions: batch pairing plus stated requests is the old output. */
function batchOutput(state: DerivationState) {
  const requests = Object.entries(state.sessions).flatMap(([id, record]) => pairSession(id, record.facts, record.observations));
  const raw = requests.filter(request => !Object.hasOwn(state.explicit, request.id));
  const stated = Object.values(state.explicit).flatMap(facts => facts.request ?? []);
  return Object.fromEntries([...raw, ...stated].map(request => [request.id, request]));
}

test('a few thousand requests in one session replay within 3 s with exact batch output and SQL restore', async context => {
  for (const [sessions, requests] of [[400, 5], [1, 2000]]) {
    const log = new SqliteEventLog(':memory:');
    const store = new SqliteProjectionStore(':memory:');
    try {
      await log.append([...volumeRequestEvents(sessions, requests)]);
      const projector = new Projector(log, [requestDerivation], store);
      const started = performance.now();
      await projector.catchUp();
      const elapsed = performance.now() - started;
      context.diagnostic(`${sessions} sessions, 2000 requests: ${elapsed.toFixed(1)} ms`);
      if (sessions === 1) assert.ok(elapsed < 3000, `concentrated replay took ${elapsed.toFixed(1)} ms`);
      const state = projector.state('requests') as DerivationState;
      assert.equal(Object.keys(state.requests).length, 2000);
      assert.equal(canonicalJson(state.requests), canonicalJson(batchOutput(state)));
      const restored = new Projector(log, [requestDerivation], store);
      assert.equal(canonicalJson(restored.state('requests')), canonicalJson(state));
      assert.ok(Object.values(projector.skipped.counts).every(count => count === 0));
    } finally { store.close(); log.close(); }
  }
});

test('session-array deltas survive rollback and append only the new observation on retry', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const codec = new SqliteRequestSessions(db, 0);
    const state = requestDerivation.initial() as DerivationState;
    const events = [...volumeRequestEvents(1, 2)];
    for (const event of events.slice(0, 3)) requestDerivation.apply(state, event);
    const record = state.sessions['session-0'];
    db.exec('BEGIN');
    const metadata = codec.write('session-0', record);
    db.exec('COMMIT');
    codec.committed();
    const rows = () => db.prepare('SELECT COUNT(*) AS count FROM request_session_arrays').get()!.count;
    assert.equal(rows(), 3);
    requestDerivation.apply(state, events[3]);
    db.exec('BEGIN');
    codec.write('session-0', record);
    db.exec('ROLLBACK');
    codec.rolledBack();
    assert.equal(rows(), 3);
    db.exec('BEGIN');
    codec.write('session-0', record);
    db.exec('COMMIT');
    codec.committed();
    assert.equal(rows(), 4);
    const restored: DerivationState = { requests: {}, explicit: {}, sessions: { 'session-0': metadata as SessionRecord } };
    codec.load(restored);
    assert.equal(canonicalJson(restored.sessions['session-0']), canonicalJson(record));
  } finally { db.close(); }
});
