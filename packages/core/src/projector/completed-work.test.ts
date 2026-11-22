import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consoleProjections, readModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { testEvent } from '../testing/events.ts';
import { createCompletedWorkRuntime } from './completed-work-runtime.ts';
import { now, plain, workSpec } from './completed-work-spec.ts';
import { Projector } from './projector.ts';
import type { WorkState } from '../projections/work.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';

const resident = (projector: Projector) => Object.values((projector.state('work') as WorkState).jobs);
const terminals = (projector: Projector) => resident(projector).filter(row => row.status === 'done' || row.status === 'failed');

const storedJob = (id: string, status = 'done') => ({ id, status, startedAt: 't', sessionId: null, kind: 'job', name: id, exitCode: 0, finishedAt: 't' });

test('a row-shaped pre-index store backfills lazily without changing ordinary load semantics', () => {
  const store = new SqliteProjectionStore(':memory:');
  try {
    store.saveChanges([{ name: 'work', version: 2, position: 12, state: { jobs: {}, reviews: {} }, rows: [
      { collection: 'jobs', id: 'done', value: storedJob('done') },
      { collection: 'jobs', id: 'running', value: storedJob('running', 'running') },
    ] }]);
    const before = plain(store.load('work'));
    const rows = store.workRows();
    assert.equal(rows.count({}), 1);
    assert.deepEqual(Object.keys((rows.restore(2)!.state as WorkState).jobs), ['running']);
    assert.deepEqual(plain(store.load('work')), before);
    store.saveChanges([{ name: 'work', version: 3, position: 13, state: { jobs: {}, reviews: {} }, resetRows: true, rows: [] }]);
    assert.equal(rows.count({}), 0);
    assert.equal(rows.get('done'), undefined);
  } finally { store.close(); }
});

test('an ordinary writer opened before activation maintains the index and rolls snapshot writes back atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'console-work-writer-'));
  const path = join(directory, 'console.db');
  const writer = new SqliteProjectionStore(path);
  const indexed = new SqliteProjectionStore(path);
  const rows = indexed.workRows();
  try {
    writer.save([{ name: 'work', version: 2, position: 0, state: { jobs: { j: storedJob('j') }, reviews: {} } }]);
    assert.equal(rows.count({}), 1);
    assert.throws(() => writer.save([
      { name: 'work', version: 3, position: 1, state: { jobs: {}, reviews: {} } },
      { name: 'bad', version: 1, position: 1, state: { bad: 1n } },
    ]));
    assert.equal(rows.count({}), 1);
    assert.equal(writer.load('work')!.version, 2);
  } finally { writer.close(); indexed.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('terminal rows are dirty until commit, active rows survive, warm restore hydrates no completed history', async () => {
  const spec = await workSpec();
  try {
    await spec.append([
      testEvent(1, 'JobFinished', { jobId: '__proto__', status: 'failed', exitCode: 1 }),
      testEvent(2, 'JobStarted', { jobId: 'running', name: 'running', kind: 'ci' }),
      testEvent(3, 'PhaseQueued', { phaseId: 'q', label: 'queued' }),
      testEvent(4, 'ReviewRecorded', { reviewId: 'r', headSha: 'abc', verdict: 'approve' }),
    ]);
    assert.equal(terminals(spec.sql).length, 1);
    spec.sql.flush();
    assert.equal(terminals(spec.sql).length, 0);
    const warm = new Projector(spec.log, consoleProjections(), spec.store, { work: createCompletedWorkRuntime(spec.store) });
    assert.equal(terminals(warm).length, 0);
    assert.equal(resident(warm).length, 2);
    assert.deepEqual(plain(new ConsoleQueries(() => readModels(warm), now).snapshot('t')), plain(spec.expected.snapshot('t')));
    assert.deepEqual(plain((warm.state('work') as WorkState).reviews), plain((spec.memory.state('work') as WorkState).reviews));
  } finally { spec.close(); }
});

test('restart catches up unflushed late events from the saved work position', async () => {
  const spec = await workSpec();
  try {
    await spec.append([testEvent(1, 'JobFinished', { jobId: 'j', status: 'done' })]);
    spec.sql.flush();
    await spec.append([
      testEvent(2, 'JobStarted', { jobId: 'j', sessionId: 'owner', kind: 'ci', name: 'late' }),
      testEvent(3, 'PhaseFinished', { phaseId: 'p', label: 'pending', exitCode: 1 }),
    ]);
    const restarted = new Projector(spec.log, consoleProjections(), spec.store, { work: createCompletedWorkRuntime(spec.store) });
    assert.equal(restarted.position, 1);
    await restarted.catchUp();
    assert.deepEqual(plain(new ConsoleQueries(() => readModels(restarted), now).snapshot('t')), plain(spec.expected.snapshot('t')));
    assert.equal(terminals(restarted).length, 0);
  } finally { spec.close(); }
});

test('failed transactions retain dirty terminal state and roll back the work index with rows and positions', async () => {
  const spec = await workSpec();
  const db = new DatabaseSync(spec.path);
  try {
    await spec.append([testEvent(1, 'JobFinished', { jobId: 'j', status: 'done' })]);
    db.exec("CREATE TRIGGER fail_work BEFORE INSERT ON projection_rows WHEN NEW.name = 'work' BEGIN SELECT RAISE(ABORT, 'spec failure'); END");
    assert.throws(() => spec.sql.flush(), /spec failure/);
    assert.equal(terminals(spec.sql).length, 1);
    assert.equal(spec.store.workRows().count({}), 0);
    assert.equal(spec.store.load('work'), undefined);
    db.exec('DROP TRIGGER fail_work');
    spec.sql.flush();
    assert.equal(terminals(spec.sql).length, 0);
    assert.equal(spec.store.workRows().count({}), 1);
  } finally { db.close(); spec.close(); }
});

test('work-only version and legacy snapshot rebuilds never hydrate stale rows across replay flushes', async () => {
  const spec = await workSpec();
  try {
    await spec.append(Array.from({ length: 1100 }, (_, n) => testEvent(n + 1, 'JobFinished', { jobId: `j${n}`, status: 'done' })));
    spec.sql.flush();
    for (const legacy of [false, true]) {
      if (legacy) spec.store.save([{ name: 'work', version: 2, position: 1100, state: { jobs: { stale: { id: 'stale', status: 'done', startedAt: '2099', sessionId: null, name: 'stale', kind: 'job', exitCode: 0, finishedAt: '2099' } }, reviews: {} } }]);
      else {
        const db = new DatabaseSync(spec.path);
        db.exec("UPDATE projections SET version = 1 WHERE name = 'work'");
        db.close();
      }
      const rebuilt = new Projector(spec.log, consoleProjections(), spec.store, { work: createCompletedWorkRuntime(spec.store) });
      const queries = new ConsoleQueries(() => readModels(rebuilt), now);
      assert.deepEqual(queries.jobs(), []);
      await rebuilt.catchUp();
      assert.equal(terminals(rebuilt).length, 0);
      assert.deepEqual(plain(queries.jobs()), plain(spec.expected.jobs()));
    }
    await spec.append([testEvent(1200, 'JobStarted', { jobId: 'j1', name: 'late', kind: 'ci' })]);
    spec.sql.flush();
    assert.equal(spec.actual.jobById('j1')?.status, 'done');
  } finally { spec.close(); }
});
