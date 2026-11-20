import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLine, type Mapper } from '../tailing/events.ts';
import { contextMapper } from './context.ts';
import { laneMapper, laneMessageMapper, rosterMapper } from './lanes.ts';
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
  ['context', contextMapper, 'context-budget', 1], ['lanes', laneMapper, 'lane-messages', 0],
  ['roster', rosterMapper, 'lane-messages', 0], ['laneMessage', laneMessageMapper, 'lane-messages', 0],
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
