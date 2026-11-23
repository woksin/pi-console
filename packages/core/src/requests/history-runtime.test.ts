import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { canonicalJson } from '../projector/canonical.ts';
import { Projector } from '../projector/projector.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { testEvent } from '../testing/events.ts';
import { requestDerivation } from './derivation.ts';
import { createRequestHistoryRuntime } from './history-runtime.ts';
import type { DerivationState, SessionRecord } from './model.ts';
import { volumeRequestEvents } from './replay-fixture.ts';
import { SqliteRequestSessions } from './sqlite-sessions.ts';

const run = promisify(execFile);
let next = 100_000;
const fact = (type: string, payload: unknown): NewEvent => testEvent(++next, type, payload);
const stated = (requestId: string, sessionId: string, entryId: string) => fact('RequestObserved', {
  requestId, sessionId, entryId, origin: 'human', originEvidence: 'explicit fixture', excerpt: `stated ${requestId}`,
});

/** Three normalized sessions of 60 requests, then explicit overlays, moves, resets and unrelated events. */
function fixtureEvents(): { history: NewEvent[]; later: NewEvent[][] } {
  const history = [...volumeRequestEvents(3, 60)] as NewEvent[];
  const later = [
    [fact('SessionHeartbeat', { sessionId: 'session-1', status: 'ok' })],
    [fact('AnswerObserved', { raw: true, sessionId: 'session-1', answerId: 'late', entryId: 'late', interim: false, excerpt: 'late', withheld: false })],
    [stated('session-0:2', 'session-2', 'entry-2'), fact('AnswerObserved', { requestId: 'session-0:2', answerId: 'x', interim: false, excerpt: 'moved' })],
    [fact('ResetOccurred', { sessionId: 'session-1', resetId: 'r1', kind: 'compaction', interruptedRequestIds: ['session-0:2'] })],
    [fact('SubagentStarted', { sessionId: 'session-2', parentSessionId: 'session-0' }), fact('SessionEnded', { sessionId: 'session-0', reason: 'exit' })],
  ];
  return { history, later };
}

async function withProjectors(test: (log: SqliteEventLog, store: SqliteProjectionStore) => Promise<void>): Promise<void> {
  const log = new SqliteEventLog(':memory:');
  const store = new SqliteProjectionStore(':memory:');
  try { await test(log, store); } finally { store.close(); log.close(); }
}

const lazy = (log: SqliteEventLog, store: SqliteProjectionStore) =>
  new Projector(log, [requestDerivation], store, { requests: createRequestHistoryRuntime(store) });
const residentObservations = (state: DerivationState) => Object.values(state.sessions).reduce((sum, record) => sum + record.observations.length, 0);

test('lazy restore hydrates only the sessions an event needs, and releases them after commit', async () => {
  await withProjectors(async (log, store) => {
    const { history, later } = fixtureEvents();
    await log.append(history);
    await lazy(log, store).catchUp();
    const restart = async (events: NewEvent[]) => {
      await log.append(events);
      const projector = lazy(log, store);
      const before = store.requestSessions.hydrations;
      assert.equal(residentObservations(projector.state('requests') as DerivationState), 0, 'restore leaves normalized histories on disk');
      await projector.catchUp();
      assert.equal(residentObservations(projector.state('requests') as DerivationState), 0, 'commit releases hydrated histories');
      return store.requestSessions.hydrations - before;
    };
    assert.equal(await restart(later[0]), 0, 'an unrelated event hydrates nothing');
    assert.equal(await restart(later[1]), 1, 'an ordinary event hydrates its session');
    assert.equal(await restart(later[2]), 2, 'a move hydrates the previous and new owner');
    assert.equal(await restart(later[3]), 2, 'reset plus the interrupted request owner');
    assert.equal(store.requestSessions.hydrations > 0, true);
  });
});

test('lazy runtime produces the same public requests and complete persisted state as a pure replay', async () => {
  await withProjectors(async (log, store) => {
    const { history, later } = fixtureEvents();
    const reference = requestDerivation.initial() as unknown as DerivationState;
    await log.append(history);
    for (const event of history) requestDerivation.apply(reference, { ...event, seq: 0, recordedAt: event.occurredAt });
    for (const chunk of later) {
      await log.append(chunk);
      for (const event of chunk) requestDerivation.apply(reference, { ...event, seq: 0, recordedAt: event.occurredAt });
      const projector = lazy(log, store);
      await projector.catchUp();
      assert.equal(canonicalJson((projector.state('requests') as DerivationState).requests), canonicalJson(reference.requests));
    }
    const complete = store.load('requests')?.state as DerivationState;
    assert.equal(canonicalJson(complete.sessions), canonicalJson(reference.sessions), 'all three session arrays equal the pure replay');
    assert.equal(canonicalJson(complete.explicit), canonicalJson(reference.explicit));
    assert.ok(Object.values(complete.sessions).some(record => record.observations.length > 64), 'fixture exercises normalized storage');
  });
});

test('a rolled-back flush keeps hydrated history and dirty indices for the retry', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const codec = new SqliteRequestSessions(db, 0);
    const state = requestDerivation.initial() as DerivationState;
    const events = [...volumeRequestEvents(1, 3)];
    for (const event of events.slice(0, 3)) requestDerivation.apply(state, event);
    const record = state.sessions['session-0'];
    const write = (outcome: 'COMMIT' | 'ROLLBACK') => {
      db.exec('BEGIN');
      const facts = codec.write('session-0', record);
      db.exec(outcome);
      if (outcome === 'COMMIT') codec.committed(); else codec.rolledBack();
      return facts;
    };
    const facts = write('COMMIT');
    assert.equal(codec.release(record), true);
    assert.deepEqual(record.observations, []);
    codec.hydrate('session-0', record);
    requestDerivation.apply(state, events[3]);
    write('ROLLBACK');
    assert.ok(record.observations.length > 1, 'rollback does not evict');
    write('COMMIT');
    const restored: DerivationState = { requests: {}, explicit: {}, sessions: { 'session-0': facts as SessionRecord } };
    codec.load(restored);
    assert.equal(canonicalJson(restored.sessions['session-0']), canonicalJson(record));
  } finally { db.close(); }
});

/** Normalized history with a fixed (empty) public state: a prompt, an abort, then many raw answers of ~2 KiB. */
function buildHistoryDatabase(path: string, observations: number): void {
  const store = new SqliteProjectionStore(path);
  try {
    const at = '2026-01-01T00:00:00.000Z';
    const sessions: Record<string, SessionRecord> = {};
    for (let session = 0; session < 3; session++) {
      const items: SessionRecord['observations'] = [
        { kind: 'prompt', key: `${at}|0`, at, entryId: null, requestId: `p${session}`, text: 'prompt', withheld: false, ref: null, derivedFrom: 'session-jsonl' },
        { kind: 'abort', key: `${at}|1`, at, entryId: null },
      ];
      for (let index = 0; index < observations; index++) {
        items.push({ kind: 'answer', key: `${at}|${String(index + 2).padStart(9, '0')}`, at, entryId: null, answerId: `a${index}`, text: `${index} `.repeat(500), withheld: false });
      }
      sessions[`s${session}`] = { facts: { child: false, parentSessionId: null, parentSessionKnown: true }, observations: items, explicitIds: [], requestIds: [] };
    }
    const rows = Object.entries(sessions).map(([id, value]) => ({ collection: 'sessions', id, value }));
    store.saveChanges([{ name: 'requests', version: requestDerivation.version, position: 1, state: { requests: {}, sessions: {}, explicit: {} }, rows, resetRows: true }]);
  } finally { store.close(); }
}

async function probe(path: string, mode: 'eager' | 'lazy') {
  const child = fileURLToPath(new URL('./restore-probe-child.ts', import.meta.url));
  const { stdout } = await run(process.execPath, ['--expose-gc', child, path, mode], { maxBuffer: 1 << 20 });
  return JSON.parse(stdout) as { restoreOverhead: number; retainedOverhead: number; resident: number; hydrations: number };
}

test('warm restore overhead stays flat as persisted history grows (eager restore does not)', async context => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-restore-'));
  try {
    const mib = 1024 * 1024;
    const results: Record<string, Awaited<ReturnType<typeof probe>>> = {};
    for (const [label, observations] of [['small', 500], ['large', 5_000]] as const) {
      const path = join(directory, `${label}.db`);
      buildHistoryDatabase(path, observations);
      for (const mode of ['lazy', 'eager'] as const) results[`${label}-${mode}`] = await probe(path, mode);
    }
    context.diagnostic(JSON.stringify(results, (_, value: unknown) => typeof value === 'number' && value > mib ? `${(value / mib).toFixed(1)} MiB` : value));
    for (const key of ['small-lazy', 'large-lazy']) {
      assert.equal(results[key].resident, 0, `${key} materializes no observations`);
      assert.equal(results[key].hydrations, 0);
    }
    assert.equal(results['large-eager'].resident, 3 * 5_002);
    const growth = results['large-lazy'].restoreOverhead - results['small-lazy'].restoreOverhead;
    assert.ok(growth <= 12 * mib, `lazy restore grew ${(growth / mib).toFixed(1)} MiB`);
    assert.ok(results['large-lazy'].retainedOverhead <= 24 * mib);
    assert.ok(results['large-eager'].retainedOverhead > results['large-lazy'].retainedOverhead + 12 * mib, 'eager restore retains the histories');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
