import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { Projector, type ProjectionChanges } from '../projector/projector.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { testEvent } from '../testing/events.ts';
import { ConsoleQueries } from './console-queries.ts';
import { IncrementalQueries } from './incremental.ts';
import { deltaFor } from './deltas.ts';
import { normalizedCwd } from './session-identity.ts';

test('lexical normalization distinguishes an unknown cwd from root and preserves case', () => {
  assert.equal(normalizedCwd(''), '');
  assert.equal(normalizedCwd(' \t\n'), '');
  assert.equal(normalizedCwd('/'), '/');
  assert.equal(normalizedCwd(' / '), '/');
  assert.equal(normalizedCwd(' \t/work/repo///\n'), '/work/repo');
  assert.equal(normalizedCwd(' C:\\Work\\repo\\ '), 'C:/Work/repo');
});

const start = (n: number, sessionId = 's', cwd = '/work/repo/') => testEvent(n, 'SessionStarted', { sessionId, cwd, model: null, role: 'main', parentSessionId: null });
const lane = (n: number, laneId: string, extra: Record<string, unknown> = {}) => testEvent(n, 'LaneRegistered', { laneId, name: laneId, repositoryId: 'other-repo', ...extra }, { source: 'lane-messages' });
const cost = (n: number, costUsd: number | null) => testEvent(n, 'SessionCostObserved', { sessionId: 's', entryId: `entry-${String(n)}`, costUsd });

async function fixture(t: { after: (fn: () => void) => void }) {
  const log = new SqliteEventLog(':memory:');
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  t.after(() => { projector.stop(); log.close(); });
  const models = () => readModels(projector);
  const now = new Date('2026-11-20T08:00:00Z');
  const full = new ConsoleQueries(models, () => now);
  const incremental = new IncrementalQueries(models, now);
  let changes: ProjectionChanges = new Map();
  projector.onApplied((_event, dirty) => { changes = dirty; });
  const append = async (event: ReturnType<typeof testEvent>) => {
    await log.append([event]);
    const changed = incremental.update(changes, now);
    assert.deepEqual(incremental.sessions(), full.sessions());
    for (const session of full.sessions()) assert.deepEqual(incremental.sessionById(session.id), session);
    return changed;
  };
  return { log, projector, models, full, incremental, append };
}

test('exact lexical cwd association invalidates old/new owners, preserves metadata and never guesses', async t => {
  const f = await fixture(t);
  await f.append(start(1));
  await f.append(start(2, 'same-cwd'));
  assert.equal(f.full.sessionById('s')!.laneId, 'unassigned');
  const added = await f.append(lane(3, 'L1', { cwd: '\\work\\repo', branch: 'feature' }));
  assert.deepEqual([...added.sessions].sort(), ['s', 'same-cwd']);
  assert.equal(f.full.sessionById('s')!.branch, 'feature');
  assert.equal(f.full.sessionById('s')!.repositoryId, '/work/repo/');
  await f.append(lane(4, 'L1'));
  assert.equal(f.full.sessionById('s')!.branch, 'feature');
  await f.append(lane(5, 'L1', { cwd: '/old', branch: 'late' }));
  await f.append({ ...lane(6, 'L1', { cwd: '/wrong', branch: 'older' }), occurredAt: '2026-01-01T00:00:00Z' });
  assert.equal(f.models().lanes.lanes.L1.branch, 'late');
  assert.equal(f.full.sessionById('s')!.laneId, 'unassigned');
  await f.append(lane(7, 'L1', { cwd: '/work/repo', branch: 'current' }));
  await f.append(lane(8, 'L2', { cwd: '/work/repo', branch: 'other' }));
  assert.equal(f.full.sessionById('s')!.laneId, 'unassigned');
  await f.append(lane(9, 'L2', { cwd: null, branch: null }));
  assert.equal(f.full.sessionById('s')!.laneId, 'L1');
  await f.append(testEvent(10, 'LaneClosed', { laneId: 'L1' }, { source: 'lane-messages' }));
  assert.equal(f.full.sessionById('s')!.laneId, 'L1');
  await f.append(lane(11, 'L1', { branch: null }));
  assert.equal(f.full.sessionById('s')!.branch, '');
  await f.append(lane(12, 'L1', { cwd: '/WORK/repo' }));
  assert.equal(f.full.sessionById('s')!.laneId, 'unassigned');
});

test('registry and session cwd trim whitespace and separators without matching prefixes', async t => {
  const f = await fixture(t);
  await f.append(start(1, 's', ' \t/work/repo///\n'));
  await f.append(start(2, 'clean', '/work/repo'));
  await f.append(start(3, 'child', '/work/repo/child'));
  await f.append(start(4, 'sibling', '/work/repository'));
  const changed = await f.append(lane(5, 'L1', { cwd: ' \t\\work\\repo\\\\\n', branch: 'feature' }));
  assert.deepEqual([...changed.sessions].sort(), ['clean', 's']);
  for (const id of ['s', 'clean']) {
    assert.equal(f.full.sessionById(id)!.laneId, 'L1');
    assert.equal(f.full.sessionById(id)!.branch, 'feature');
  }
  for (const id of ['child', 'sibling']) assert.equal(f.full.sessionById(id)!.laneId, 'unassigned');
});

test('lane updates and point/page reads do not scan session or lane rows after bootstrap', async t => {
  const log = new SqliteEventLog(':memory:');
  await log.append(Array.from({ length: 1000 }, (_, n) => start(n + 1, `s${String(n)}`, n === 0 ? '/work/repo' : `/unrelated/${String(n)}`)));
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  t.after(() => { projector.stop(); log.close(); });
  const models = readModels(projector);
  const now = new Date('2026-11-20T08:00:00Z');
  const queries = new IncrementalQueries(() => models, now);
  const scans: string[] = [];
  const tracked = <Row>(rows: Record<string, Row>) => new Proxy(rows, { ownKeys(target) { scans.push(new Error('whole-table scan').stack!); return Reflect.ownKeys(target); } });
  models.sessions.sessions = tracked(models.sessions.sessions);
  models.lanes.lanes = tracked(models.lanes.lanes);
  let affected = new Set<string>();
  projector.onApplied((_event, changes) => { affected = queries.update(changes, now).sessions; });
  await log.append([lane(1001, 'L1', { cwd: '/work/repo', branch: 'feature' })]);
  assert.deepEqual([...affected], ['s0']);
  assert.equal(queries.sessionById('s0')!.branch, 'feature');
  assert.deepEqual(scans, []);
  assert.equal(queries.page('sessions', { limit: 10 }).items.length, 10);
  // Existing page/attention enumeration is once per table, not one lane scan per rendered session.
  assert.ok(scans.length <= 3);
});

test('observed costs accumulate outside samples, deduplicate and survive projection replay', async t => {
  const f = await fixture(t);
  await f.append(start(1));
  assert.equal(f.full.sessionById('s')!.costUsd, null);
  await f.append(cost(2, null));
  assert.equal(f.full.sessionById('s')!.costIncomplete, true);
  await f.append(cost(3, 0));
  assert.equal(f.full.sessionById('s')!.costUsd, 0);
  for (let n = 4; n <= 34; n++) await f.append(cost(n, 0.5));
  assert.equal(f.full.sessionById('s')!.costUsd, 15.5);
  assert.deepEqual(f.full.sessionById('s')!.samples, []);
  const before = f.full.sessionById('s');
  await f.log.append([cost(34, 0.5)]);
  assert.deepEqual(f.full.sessionById('s'), before);
  const late = { ...cost(35, 1), occurredAt: '2026-01-01T00:00:00Z' };
  await f.append(late);
  assert.equal(f.full.sessionById('s')!.updatedAt, before!.updatedAt);
  const event = (await Array.fromAsync(f.log.readFrom(0))).at(-1)!;
  assert.equal(deltaFor(f.full, event)?.type, 'session.updated');
  f.projector.stop();
  const replay = new Projector(f.log, consoleProjections().map(projection => ({ ...projection, version: projection.version + 1 })));
  await replay.catchUp();
  const queries = new ConsoleQueries(() => readModels(replay));
  assert.equal(queries.sessionById('s')!.costUsd, 16.5);
  assert.equal(queries.sessionById('s')!.costIncomplete, true);
});
