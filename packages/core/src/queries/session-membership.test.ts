import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import { syntheticModels } from '../testing/synthetic-models.ts';
import { ConsoleQueries } from './console-queries.ts';

const at = '2026-01-01T00:00:00.000Z';
const now = () => new Date(at);
const empty = { jobs: 0, messages: 0, requests: 0, questions: 0 };

function attentionItem(id: string, sessionId: string | null, reason: AttentionItem['reason']): AttentionItem {
  return { id, sessionId, reason, laneId: null, text: id, since: at, pointer: null };
}

function membershipFixture(size: number) {
  const models = syntheticModels({ sessions: size, ...empty });
  const rows = Object.values(models.sessions.sessions);
  for (const row of rows) { row.endedAt = null; row.openTurnId = null; row.parentSessionId = null; }
  let visits = 0;
  const attention = rows.flatMap(row => [
    attentionItem(`lane:${row.id}`, null, 'lane-waiting-on-user'),
    attentionItem(`request:${row.id}`, row.id, 'open-request'),
    attentionItem(`question:${row.id}`, row.id, 'blocking-question'),
  ]).map(item => ({ ...item, get sessionId() { visits++; return item.sessionId; } }));
  class Queries extends ConsoleQueries {
    override needsYou() { return attention; }
  }
  return { rows, attention, queries: new Queries(() => models, now), visits: () => visits, reset: () => { visits = 0; } };
}

const batchQueries: [string, (queries: ConsoleQueries) => Session[]][] = [
  ['list', queries => queries.sessions()],
  ['page', queries => queries.page('sessions', { limit: 1000 }).items as Session[]],
  ['screen', queries => queries.screenSnapshot(at).sessions],
];

for (const [name, query] of batchQueries) {
  test(`${name} session membership visits each attention owner once, including duplicates and null owners`, t => {
    const measurements = [128, 256].map(size => {
      const fixture = membershipFixture(size);
      // The former per-session membership algorithm, over the exact same instrumented attention items.
      for (const row of fixture.rows) assert.ok(fixture.attention.some(item => item.sessionId === row.id));
      const before = fixture.visits();
      fixture.reset();
      const sessions = query(fixture.queries);
      const after = fixture.visits();
      assert.equal(sessions.length, size);
      assert.ok(sessions.every(session => session.status === 'needs-you'));
      assert.equal(after, size * 3);
      assert.equal(before, size * (3 * size + 1) / 2);
      return { size, before, after };
    });
    assert.equal(measurements[1].after, measurements[0].after * 2);
    t.diagnostic(`attention owner visits before/after: ${JSON.stringify(measurements)}`);
  });
}

function statusFixture() {
  const cases: [string, Session['status']][] = [
    ['done', 'done'], ['failed', 'failed'], ['blocked', 'blocked'], ['waiting', 'waiting'],
    ['working', 'working'], ['idle', 'idle'], ['__proto__', 'needs-you'], ['constructor', 'needs-you'], ['toString', 'idle'],
  ];
  const models = syntheticModels({ sessions: cases.length, ...empty });
  const template = Object.values(models.sessions.sessions)[0];
  models.sessions.sessions = Object.fromEntries(cases.map(([id]) => [id, {
    ...template, id, parentSessionId: null, endedAt: null, openTurnId: null, heartbeatStatus: null,
  }]));
  const rows = models.sessions.sessions;
  rows.done.endedAt = at;
  rows.failed.endedAt = at;
  rows.failed.endReason = 'crashed';
  rows.blocked.heartbeatStatus = 'blocked';
  rows.waiting.heartbeatStatus = 'waiting';
  rows.working.openTurnId = 'turn';
  for (const id of ['__proto__', 'constructor']) rows[id].heartbeatStatus = 'blocked';
  const attention = ['done', 'failed', '__proto__', 'constructor'].flatMap(id => [
    attentionItem(`request:${id}`, id, 'open-request'), attentionItem(`question:${id}`, id, 'blocking-question'),
  ]);
  attention.push(attentionItem('lane:unknown', null, 'lane-waiting-on-user'));
  class Queries extends ConsoleQueries {
    override needsYou() { return attention; }
  }
  return { queries: new Queries(() => models, now), expected: Object.fromEntries(cases) };
}

test('terminal, attention, heartbeat and turn status precedence is identical in point, list, page and snapshots', () => {
  const { queries, expected } = statusFixture();
  const sessions = queries.sessions();
  assert.deepEqual(Object.fromEntries(sessions.map(session => [session.id, session.status])), expected);
  for (const session of sessions) assert.deepEqual(queries.sessionById(session.id), session);
  assert.deepEqual(queries.page('sessions', { limit: 1000 }).items, sessions);
  assert.deepEqual(queries.screenSnapshot(at).sessions, sessions);
  assert.deepEqual(queries.snapshot(at).sessions, sessions);
  assert.equal(queries.sessionById('missing'), undefined);
});

test('long-lived queries refresh membership after model changes and stale-time transitions', () => {
  const models = syntheticModels({ sessions: 1, ...empty });
  const row = Object.values(models.sessions.sessions)[0];
  row.openTurnId = null;
  let clock = new Date(at);
  const queries = new ConsoleQueries(() => models, () => clock);
  assert.equal(queries.sessionById(row.id)?.status, 'idle');
  const source = syntheticModels({ sessions: 1, ...empty, requests: 1 });
  const request = Object.values(source.requests.requests)[0];
  request.status = 'open';
  models.requests.requests[request.id] = request;
  assert.equal(queries.sessions()[0].status, 'needs-you');
  request.status = 'answered';
  assert.equal((queries.page('sessions', { limit: 1 }).items[0] as Session).status, 'idle');
  row.openTurnId = 'turn';
  assert.equal(queries.screenSnapshot(at).sessions[0].status, 'working');
  clock = new Date('2026-01-01T00:31:00.000Z');
  assert.equal(queries.sessionById(row.id)?.status, 'needs-you');
  clock = new Date(at);
  assert.equal(queries.sessions()[0].status, 'working');
});
