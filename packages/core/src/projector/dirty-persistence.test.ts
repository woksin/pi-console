import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { scenario } from '../testing/scenario.ts';
import { testEvent } from '../testing/events.ts';
import { canonicalJson } from './canonical.ts';
import { Projector } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';
import type { ProjectionWrite } from './projection.ts';
import type { WorkState } from '../projections/work.ts';

const now = () => new Date('2026-01-01');
const serialise = (projector: Projector) => {
  const queries = new ConsoleQueries(() => readModels(projector), now);
  return canonicalJson({ models: readModels(projector), skipped: projector.skipped,
    snapshot: queries.snapshot(now().toISOString()), overview: queries.overview(), graph: queries.graph(),
    details: queries.sessions().map(session => queries.session(session.id)) });
};

const moves = [
  testEvent(6001, 'RequestObserved', { requestId: '__proto__', sessionId: 'constructor', origin: 'human', originEvidence: 'spec' }),
  testEvent(6002, 'RequestObserved', { requestId: '__proto__', sessionId: '__proto__', origin: 'human', originEvidence: 'spec' }),
  testEvent(6003, 'RequestObserved', { requestId: 'raw', sessionId: '__proto__', origin: 'unproven', originEvidence: 'spec', raw: true, entryId: 'entry' }),
  testEvent(6004, 'RequestObserved', { requestId: 'override', sessionId: '__proto__', origin: 'human', originEvidence: 'spec', entryId: 'entry' }),
];

test('dirty rows equal snapshot replay through batch boundaries, unflushed crash, restore and version rebuild', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'console-dirty-'));
  const path = join(directory, 'console.db');
  const log = new SqliteEventLog(path);
  const store = new SqliteProjectionStore(path);
  try {
    const input = [...scenario({ count: 350, jitterSeconds: 120, rawRequests: true }), ...moves];
    await log.append(input);
    const expected = new Projector(log, consoleProjections());
    await expected.catchUp();
    // Repeated restores exercise SQL materialisation, not just live in-memory state.
    for (const width of [1, 7, 31, 113]) {
      const liveLog = new SqliteEventLog(join(directory, `live-${width}.db`));
      const liveStore = new SqliteProjectionStore(join(directory, `rows-${width}.db`));
      try {
        let projector = new Projector(liveLog, consoleProjections(), liveStore);
        for (let start = 0; start < input.length; start += width) {
          await liveLog.append(input.slice(start, start + width));
          await projector.catchUp();
          projector = new Projector(liveLog, consoleProjections(), liveStore);
        }
        await projector.catchUp();
        assert.equal(serialise(projector), serialise(expected));
      } finally { liveStore.close(); liveLog.close(); }
    }
    const first = new Projector(log, consoleProjections(), store);
    await first.start();
    await log.append([testEvent(7000, 'JobStarted', { jobId: 'crash', kind: 'job', name: 'crash' })]);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    // Do not stop/flush the first projector until after its replacement has recovered.
    const restored = new Projector(log, consoleProjections(), store);
    await restored.catchUp();
    first.stop();
    const full = new Projector(log, consoleProjections());
    await full.catchUp();
    assert.equal(serialise(restored), serialise(full));
    const database = new DatabaseSync(path);
    database.exec("UPDATE projections SET version = version - 1 WHERE name NOT LIKE '$%'");
    database.close();
    const rebuilt = new Projector(log, consoleProjections(), store);
    assert.equal(rebuilt.position, 0);
    await rebuilt.catchUp();
    assert.equal(serialise(rebuilt), serialise(full));
  } finally { store.close(); log.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('low-rate idle flush writes only dirty rows, and shutdown flushes pending work', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  class Store extends SqliteProjectionStore {
    batches: (readonly ProjectionWrite[])[] = [];
    override saveChanges(records: readonly ProjectionWrite[]): void {
      super.saveChanges(records);
      this.batches = [...this.batches, structuredClone(records)];
    }
  }
  const log = new SqliteEventLog(':memory:');
  const store = new Store(':memory:');
  const projector = new Projector(log, consoleProjections(), store);
  try {
    await log.append([testEvent(1, 'JobStarted', { jobId: 'unchanged', name: 'unchanged', kind: 'job' })]);
    await projector.start();
    const before = store.batches.length;
    await log.append([testEvent(2, 'JobStarted', { jobId: 'dirty', name: 'dirty', kind: 'job' })]);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(store.batches.length, before);
    context.mock.timers.tick(250);
    assert.equal(store.batches.length, before + 1);
    const batch = store.batches.at(-1)!;
    assert.deepEqual(batch.find(record => record.name === 'work')?.rows?.map(row => row.id), ['dirty']);
    assert.equal(canonicalJson(batch.find(record => record.name === 'work')?.state), '{"jobs":{},"reviews":{}}');
    assert.equal((store.load('work')!.state as WorkState).jobs.unchanged.name, 'unchanged');
    await log.append([testEvent(3, 'JobFinished', { jobId: 'dirty', status: 'done' })]);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    projector.stop();
    assert.equal((store.load('work')!.state as WorkState).jobs.dirty.status, 'done');
    const stopped = store.batches.length;
    context.mock.timers.tick(1000);
    assert.equal(store.batches.length, stopped);
  } finally { projector.stop(); store.close(); log.close(); }
});

test('rows, tombstones, versions and position roll back together when a write fails', () => {
  const store = new SqliteProjectionStore(':memory:');
  const record = { name: 'rows', version: 2, position: 1, state: { items: {} }, resetRows: true,
    rows: [{ collection: 'items', id: '__proto__', value: { count: 1 } }] };
  try {
    store.saveChanges([record]);
    const before = canonicalJson(store.load('rows'));
    assert.throws(() => store.saveChanges([
      { ...record, position: 2, resetRows: false, rows: [{ collection: 'items', id: '__proto__', value: undefined }] },
      { name: '$skipped', version: 1, position: 2, state: { bad: 1n } },
    ]));
    assert.equal(canonicalJson(store.load('rows')), before);
    assert.equal(store.load('$skipped'), undefined);
    store.saveChanges([{ ...record, position: 3, resetRows: false, rows: [{ collection: 'items', id: '__proto__', value: undefined }] }]);
    assert.equal(canonicalJson(store.load('rows')?.state), '{"items":{}}');
  } finally { store.close(); }
});
