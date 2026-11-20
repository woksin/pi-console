import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLine, type Mapper } from '../tailing/events.ts';
import { contextMapper } from './context.ts';
import { laneMapper, laneMessageMapper, laneStatusMapper, rosterMapper } from './lanes.ts';
import { orchMapper } from './orch.ts';
import { questionMapper } from './questions.ts';
import { issueMapper } from './issues.ts';
import { phaseMapper } from './phases.ts';
import { opaqueLogMapper } from './gaps.ts';
import { sessionMapper } from '../session/mapper.ts';
import { MemoryLog } from '../tailing/memory-log.test.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/sources.json', import.meta.url), 'utf8'));
const checkpoint = { source: 'session-jsonl', path: '/synthetic/source.jsonl', identity: 'synthetic', generation: 0, offset: 0, size: 0, mtimeMs: 0, headHash: '' };
const map = (value: unknown, mapper: Mapper, source: string) => mapLine(JSON.stringify(value), 0, { mapper, checkpoint: { ...checkpoint, source } });

const cases: [string, Mapper, string, number][] = [
  ['context', contextMapper, 'context-budget', 1], ['lanes', laneMapper, 'lane-messages', 3],
  ['roster', rosterMapper, 'lane-messages', 1], ['laneStatus', laneStatusMapper, 'lane-messages', 5], ['laneMessage', laneMessageMapper, 'lane-messages', 0],
  ['orch', orchMapper, 'lane-messages', 2], ['question', questionMapper, 'question-store', 1],
  ['legacyQuestion', questionMapper, 'question-store', 1],
  ['issue', issueMapper, 'issue-work', 1], ['phase', phaseMapper, 'phase-ledger', 3],
  ['jobLog', opaqueLogMapper, 'job-logs', 0], ['reviewLog', opaqueLogMapper, 'review-logs', 0],
];
for (const [key, mapper, source, expected] of cases) {
  test(`synthetic ${key} facts fit the existing catalogue without guessed lifecycle`, () => {
    if (typeof fixture[key] === 'string') {
      assert.deepEqual(mapper({ body: fixture[key] }), []);
      return;
    }
    const rows = Array.isArray(fixture[key]) ? fixture[key] : [fixture[key]];
    const events = rows.flatMap((row: unknown) => map(row, mapper, key === 'orch' && row === fixture.orch[2] ? 'lane-heartbeats' : source));
    assert.equal(events.length, expected);
    assert.ok(events.every(event => event.type !== 'SourceSchemaUnknown'));
  });
}

test('lane status lines map to contract events without free text, deadlines or invented times', () => {
  const [working, waiting, barred, parked, closed] = fixture.laneStatus.map((row: unknown) => map(row, laneStatusMapper, 'lane-messages')[0]);
  assert.deepEqual([working.type, working.payload, working.occurredAt], ['LaneStatusChanged', { laneId: 'M1', status: 'working', waitingOn: null, barredBy: null, parked: false }, '2026-07-01T10:00:00Z']);
  assert.deepEqual(waiting.payload, { laneId: 'M1', status: 'waiting-on', waitingOn: 'M2 review', barredBy: null, parked: false });
  assert.deepEqual(barred.payload, { laneId: 'M1', status: 'barred-by', waitingOn: null, barredBy: 'order-1', parked: false });
  assert.deepEqual(parked.payload, { laneId: 'M1', status: 'parked', waitingOn: 'owner decision', barredBy: null, parked: true });
  assert.equal(waiting.occurredAt, '1970-01-01T00:00:00.000Z', 'no occurrence time: the checkpoint mtime');
  assert.deepEqual([closed.type, closed.payload, closed.occurredAt], ['LaneClosed', { laneId: 'M2' }, '2026-07-01T11:00:00Z']);
  assert.ok(!JSON.stringify(closed).includes('free text'));
  assert.deepEqual([working.subject, working.refs.entryId], ['lane:M1', 'M1']);
});

test('a lane closed without a reassignment target maps to LaneClosed', () => {
  for (const line of ['closed at 2026-07-01T12:00:00Z', 'closed at 2026-07-01T12:00:00Z reason "done"']) {
    const [event] = map({ lane: 'M3', line }, laneStatusMapper, 'lane-messages');
    assert.deepEqual([event.type, event.payload, event.occurredAt], ['LaneClosed', { laneId: 'M3' }, '2026-07-01T12:00:00Z']);
  }
});

test('bad lane names and unmatched status lines are body-free warnings', () => {
  for (const row of [{ lane: 'lower', line: 'working since 2026-07-01T10:00:00Z' }, { lane: 'M1', line: 'napping secret-text' }, { lane: 'M1', line: 'working since never' }, { lane: 'M1', line: 'waiting-on "x" until never' }, { lane: 'M1' }]) {
    const events = map(row, laneStatusMapper, 'lane-messages');
    assert.deepEqual(events.map(event => event.type), ['SourceSchemaUnknown']);
    assert.ok(!JSON.stringify(events).includes('secret-text'));
  }
});

test('lane registry registers with repo, closes with its time, and never echoes other fields', () => {
  const events = map(fixture.lanes, laneMapper, 'lane-messages');
  assert.deepEqual(events.map(event => [event.type, event.payload]), [
    ['LaneRegistered', { laneId: 'M1', name: 'M1', repositoryId: 'example/console' }],
    ['LaneRegistered', { laneId: 'M2', name: 'M2', repositoryId: 'example/console' }],
    ['LaneClosed', { laneId: 'M2' }],
  ]);
  assert.equal(events[2].occurredAt, '2026-07-01T11:00:00Z');
  const text = JSON.stringify(events);
  for (const leaked of ['Synthetic task', 'synthetic reason', '/synthetic/console-m1', 'worker']) assert.ok(!text.includes(leaked), leaked);
  assert.equal((map({ version: 1, lanes: [{ id: 'M3' }] }, laneMapper, 'lane-messages')[0].payload as { repositoryId: unknown }).repositoryId, null);
});

test('several lanes in one record keep distinct idempotency keys', () => {
  const keys = map(fixture.lanes, laneMapper, 'lane-messages').map(event => event.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('a roster entry registers at its start and its retirement is not a lane close', () => {
  const events = map(fixture.roster, rosterMapper, 'lane-messages');
  assert.deepEqual(events.map(event => [event.type, event.occurredAt, event.payload]), [['LaneRegistered', '2026-07-01T10:00:00Z', { laneId: 'M1', name: 'M1', repositoryId: null }]]);
  assert.ok(!JSON.stringify(events).includes('/synthetic/console'));
});

test('orch heartbeat uses its session id; receipt acknowledgement is a documented contract gap', () => {
  assert.equal(map(fixture.orch[2], orchMapper, 'lane-heartbeats')[0].type, 'SessionHeartbeat');
  assert.deepEqual(map(fixture.orch[1], orchMapper, 'lane-messages'), []);
});

test('question revisions emit only their last explicit operation and unsupported priority warns', () => {
  const base = fixture.question;
  const edited = { ...base, rev: 2, history: [...base.history, { seq: 2, type: 'edited', ts: '2026-07-01T10:01:00Z' }] };
  assert.equal(map(edited, questionMapper, 'question-store')[0].type, 'QuestionRevised');
  for (const [type, expected] of [['answered', 'QuestionAnswered'], ['withdrawn', 'QuestionClosed'], ['deferred', 'QuestionDeferred']]) {
    const row = { ...edited, answer: { text: 'Synthetic answer' }, history: [...base.history, { seq: 2, type, ts: '2026-07-01T10:01:00Z' }] };
    assert.equal(map(row, questionMapper, 'question-store')[0].type, expected);
  }
  assert.equal(map({ ...base, priority: 'low' }, questionMapper, 'question-store')[0].type, 'SourceSchemaUnknown');
  assert.equal(map({ ...base, rev: 99 }, questionMapper, 'question-store')[0].type, 'SourceSchemaUnknown');
});

test('unversioned local questions retain explicit timestamps, decisions, closures and comment gaps', () => {
  const base = fixture.legacyQuestion;
  assert.equal(map({ ...base, body: '' }, questionMapper, 'question-store')[0].type, 'QuestionAsked');
  for (const [type, expected] of [['decided', 'QuestionAnswered'], ['closed', 'QuestionClosed'], ['edited', 'QuestionRevised']]) {
    const row = { ...base, rev: 2, answer: { text: 'Synthetic choice' }, history: [...base.history, { seq: 2, type, at: '2026-07-01T10:01:00Z' }] };
    const events = map(row, questionMapper, 'question-store');
    assert.equal(events[0].type, expected);
    assert.equal(events[0].occurredAt, '2026-07-01T10:01:00Z');
  }
  const comment = { ...base, rev: 2, history: [...base.history, { seq: 2, type: 'comment', at: '2026-07-01T10:01:00Z' }] };
  assert.deepEqual(map(comment, questionMapper, 'question-store'), []);
});

test('S1 structured job deliveries retain each batch member, replay safely, and never invent turns', async () => {
  const mapper = sessionMapper('synthetic-session');
  const events = map(fixture.jobs, mapper, 'session-jsonl');
  assert.deepEqual(events.map(event => event.type), ['JobFinished', 'JobFinished']);
  assert.notEqual(events[0].idempotencyKey, events[1].idempotencyKey);
  const log = new MemoryLog();
  assert.equal((await log.append(events)).appended, 2);
  assert.equal((await log.append(events)).appended, 0);
  assert.equal(map(fixture.jobStart, mapper, 'session-jsonl')[0].type, 'JobStarted');
  assert.deepEqual(map({ ...fixture.jobs, customType: 'subagent-notification' }, mapper, 'session-jsonl'), []);
});

test('unknown enums and future source versions are warnings, not normalized guesses', () => {
  const unsupported: [unknown, Mapper, string][] = [
    [{ sessionId: 's', event: 'future' }, contextMapper, 'context-budget'],
    [{ type: 'usage' }, sessionMapper('s'), 'session-jsonl'],
    [{ type: 'context_edit' }, sessionMapper('s'), 'session-jsonl'],
    [{ ...fixture.lanes, version: 9 }, laneMapper, 'lane-messages'],
    [{ ...fixture.orch[1], state: 'future' }, orchMapper, 'lane-messages'],
    [{ ...fixture.issue, state: 'future' }, issueMapper, 'issue-work'],
    [{ ...fixture.phase, outcome: 'future' }, phaseMapper, 'phase-ledger'],
    [{ ...fixture.question, v: 2 }, questionMapper, 'question-store'],
  ];
  for (const [row, mapper, source] of unsupported) assert.equal(map(row, mapper, source)[0].type, 'SourceSchemaUnknown');
});
