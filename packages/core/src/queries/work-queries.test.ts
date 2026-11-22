import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testEvent } from '../testing/events.ts';
import { now, plain, workSpec } from '../projector/completed-work-spec.ts';
import { encodeCursor, InvalidCursorError } from './paging.ts';
import type { ConsoleQueries } from './console-queries.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { sqlWorkQueries } from './work-queries.ts';

function parity(actual: ConsoleQueries, expected: ConsoleQueries) {
  assert.deepEqual(plain(actual.jobs()), plain(expected.jobs()));
  assert.deepEqual(plain(actual.snapshot('t')), plain(expected.snapshot('t')));
  for (const recent of [0, 1, 200]) assert.deepEqual(plain(actual.screenSnapshot('t', recent)), plain(expected.screenSnapshot('t', recent)));
  for (const sessionId of [undefined, 'console', 'owner', 'other', 'missing']) {
    for (const order of ['asc', 'desc'] as const) {
      let after: string | undefined;
      do {
        const query = { limit: 2, order, sessionId, after };
        const page = actual.page('jobs', query);
        assert.deepEqual(plain(page), plain(expected.page('jobs', query)));
        after = page.nextCursor ?? undefined;
      } while (after);
    }
  }
  for (const id of ['missing', '__proto__', 'constructor', 'phase:p', 'ci']) assert.deepEqual(plain(actual.jobById(id) ?? null), plain(expected.jobById(id) ?? null));
  for (const after of ['garbage', encodeCursor('messages', '', '')]) assert.throws(() => actual.page('jobs', { limit: 2, after }), InvalidCursorError);
  assert.deepEqual(actual.page('jobs', { limit: 2, after: encodeCursor('jobs', 'z', 'z') }), { items: [], total: expected.jobs().length, hasMore: false, nextCursor: null });
  assert.deepEqual(plain(actual.session('owner')), plain(expected.session('owner')));
}

test('SQL work reads match memory before/after commit, eviction and late metadata changes', async () => {
  const spec = await workSpec();
  try {
    await spec.append([testEvent(1, 'SessionStarted', { sessionId: 'owner', cwd: '/repo', model: null, role: 'main', parentSessionId: null })]);
    const ids = ['__proto__', 'constructor', '\u{10000}', '\ue000', 'ci', 'running'];
    await spec.append(ids.map((jobId, index) => testEvent(10 + index, 'JobStarted', {
      jobId, sessionId: index % 2 ? 'owner' : null, kind: jobId === 'ci' ? 'ci' : 'job', name: jobId,
    }, { occurredAt: now().toISOString() })));
    await spec.append([
      ...ids.slice(0, -1).map((jobId, index) => testEvent(30 + index, 'JobFinished', { jobId, status: index % 2 ? 'failed' : 'done', exitCode: index % 2 })),
      testEvent(40, 'PhaseFinished', { phaseId: 'p', label: 'finished first', exitCode: 0 }),
      testEvent(41, 'PhaseQueued', { phaseId: 'queued', label: 'queued' }),
    ]);
    parity(spec.actual, spec.expected);
    spec.sql.flush();
    parity(spec.actual, spec.expected);
    await spec.append([
      testEvent(50, 'JobStarted', { jobId: '__proto__', sessionId: 'other', kind: 'ci', name: 'late' }, { occurredAt: '2020-01-01T00:00:00Z' }),
      testEvent(51, 'PhaseStarted', { phaseId: 'p', label: 'late start' }),
      testEvent(52, 'PhaseQueued', { phaseId: 'p', label: 'late queue' }),
      testEvent(53, 'JobFinished', { jobId: 'constructor', status: 'done', exitCode: 0 }),
    ]);
    parity(spec.actual, spec.expected);
    spec.sql.flush();
    parity(spec.actual, spec.expected);
  } finally { spec.close(); }
});

test('bounded reads use indexed limits and counts, and ordinary writers maintain the derived index', context => {
  const store = new SqliteProjectionStore(':memory:');
  try {
    const rows = store.workRows();
    const job = (id: string, status = 'done') => ({ id, status, sessionId: null, startedAt: 't', kind: 'job', name: id, finishedAt: 't', exitCode: 0 });
    store.saveChanges([{ name: 'work', version: 2, position: 1, state: { jobs: {}, reviews: {} }, resetRows: true,
      rows: Array.from({ length: 2500 }, (_, index) => ({ collection: 'jobs', id: `j${index}`, value: job(`j${index}`) })),
    }]);
    for (const order of ['asc', 'desc'] as const) {
      for (const sessionId of [undefined, 'console']) {
        const plan = rows.explain({ order, sessionId, after: { key: 't', id: 'j100' }, limit: 8 });
        assert.ok(plan.some(line => line.includes(sessionId ? 'work_owner_recent' : 'work_recent')), plan.join('\n'));
        assert.ok(plan.every(line => !line.includes('TEMP B-TREE')), plan.join('\n'));
      }
    }
    const select = context.mock.method(rows, 'select');
    const count = context.mock.method(rows, 'count');
    // Importing the production seam here also ensures it has no hidden projector-side history cache.
    const source = sqlWorkQueries(rows, () => ({ jobs: {}, reviews: {} }), () => true);
    assert.equal(source.page({ limit: 7 }).items.length, 7);
    assert.equal(select.mock.calls[0].arguments[0].limit, 8);
    assert.equal(select.mock.calls[0].result!.length, 8);
    assert.equal(source.window(5).items.length, 5);
    assert.equal(select.mock.calls[1].result!.length, 5);
    assert.equal(source.window(0).total, 2500);
    assert.equal(select.mock.callCount(), 2);
    assert.equal(count.mock.callCount(), 3);
    store.saveChanges([{ name: 'work', version: 2, position: 2, state: { jobs: {}, reviews: {} }, rows: [
      { collection: 'jobs', id: 'j0', value: job('j0', 'running') },
      { collection: 'jobs', id: 'j1', value: undefined },
    ] }]);
    assert.equal(rows.count({}), 2498);
    assert.equal(source.byId('j0')?.status, 'running');
    assert.equal(source.byId('j1'), undefined);
  } finally { store.close(); }
});
