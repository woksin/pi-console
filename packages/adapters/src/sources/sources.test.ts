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
  ['orch', orchMapper, 'lane-messages', 2], ['question', questionMapper, 'question-store', 2],
  ['legacyQuestion', questionMapper, 'question-store', 2],
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

const questionEvents = (value: unknown) => map(value, questionMapper, 'question-store').map(event => ({ ...event, payload: event.payload as Record<string, unknown> }));
const history = (events: ReturnType<typeof questionEvents>) => events.filter(event => event.type === 'QuestionHistoryRecorded').map(event => event.payload);

test('a question revision maps to one current-state snapshot plus every history entry, whatever the revision number', () => {
  const base = fixture.question;
  const row = {
    ...base, rev: 7, history: [
      { seq: 1, type: 'created', ts: '2026-07-01T10:00:00Z' }, { seq: 2, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'first note', actor: { kind: 'agent', sessionId: 's-1', lane: 'L0' } },
      { seq: 3, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'second note', actor: { kind: 'user', sessionId: 's-2' } },
      { seq: 5, type: 'reopened', ts: '2026-07-01T10:02:00Z' }, { seq: 6, type: 'claimed', ts: '2026-07-01T10:03:00Z', actor: 'M1' },
    ],
  };
  const events = questionEvents(row);
  assert.deepEqual(events.map(event => event.type), ['QuestionSnapshotObserved', ...Array(5).fill('QuestionHistoryRecorded')]);
  assert.deepEqual(history(events).map(item => [item.sequence, item.operation, item.actor, item.excerpt]), [
    [1, 'created', null, undefined], [2, 'comment', 'L0', 'first note'], [3, 'comment', 'user', 'second note'], [5, 'reopened', null, undefined], [6, 'claimed', 'M1', undefined],
  ]);
  assert.deepEqual({ ...events[0].payload }, {
    questionId: 'q-1', revision: 7, asker: null, kind: 'decision', urgency: 'normal', blocking: true, status: 'open', options: [], links: [],
    createdAt: '2026-07-01T10:00:00Z', updatedAt: '2026-07-01T10:03:00Z', excerpt: 'Synthetic question?', withheld: false,
  });
  assert.equal(events[0].occurredAt, '2026-07-01T10:03:00Z');
});

test('question facts have logical identities: repeated or later revisions share history keys but not snapshot keys', () => {
  const base = fixture.question;
  const later = { ...base, rev: 4, history: [...base.history, { seq: 2, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'note' }] };
  const first = questionEvents(base);
  const second = questionEvents(later);
  assert.equal(first[1].idempotencyKey, second[1].idempotencyKey);
  assert.notEqual(first[0].idempotencyKey, second[0].idempotencyKey);
  assert.notEqual(second[1].idempotencyKey, second[2].idempotencyKey);
  assert.match(second[2].idempotencyKey, /^question-store\|[0-9a-f]{64}\|0\|2\|QuestionHistoryRecorded$/);
  const moved = map(later, questionMapper, 'question-store');
  assert.deepEqual(moved.map(event => event.idempotencyKey), second.map(event => event.idempotencyKey));
});

test('question status comes from the stored status, else the latest status-changing operation', () => {
  const base = fixture.question;
  const withOperation = (type: string, extra: object = {}) => ({ ...base, ...extra, history: [...base.history, { seq: 2, type, ts: '2026-07-01T10:01:00Z' }, { seq: 3, type: 'comment', ts: '2026-07-01T10:02:00Z' }] });
  for (const [type, expected] of [['answered', 'answered'], ['decided', 'answered'], ['withdrawn', 'closed'], ['superseded', 'closed'], ['deferred', 'deferred'], ['closed', 'closed']]) {
    assert.equal(questionEvents(withOperation(type))[0].payload.status, expected, type);
  }
  assert.equal(questionEvents(withOperation('answered', { status: 'deferred' }))[0].payload.status, 'deferred');
  assert.equal(questionEvents(withOperation('answered', { status: 'invented' }))[0].type, 'SourceSchemaUnknown');
});

test('unversioned local questions map actor objects, options, links, stored times and answer notes per entry', () => {
  const base = fixture.legacyQuestion;
  const row = {
    ...base, rev: 3, status: 'decided', createdAt: '2026-07-01T09:59:00Z', updatedAt: '2026-07-01T10:05:00Z', options: [{ key: 'a', text: 'Yes' }, { key: 'b', text: 'No' }],
    links: ['https://example.invalid/issues/1'], answer: { text: 'Final answer' },
    history: [...base.history, { seq: 2, type: 'edited', at: '2026-07-01T10:01:00Z', text: 'text', actor: { kind: 'agent', sessionId: 's', name: 'worker' } },
      { seq: 3, type: 'decided', at: '2026-07-01T10:05:00Z', text: 'Chose yes', actor: { kind: 'user', sessionId: 'u' } }],
  };
  const events = questionEvents(row);
  assert.deepEqual({ status: events[0].payload.status, options: events[0].payload.options, links: events[0].payload.links, createdAt: events[0].payload.createdAt, updatedAt: events[0].payload.updatedAt },
    { status: 'answered', options: ['Yes', 'No'], links: ['https://example.invalid/issues/1'], createdAt: '2026-07-01T09:59:00Z', updatedAt: '2026-07-01T10:05:00Z' });
  assert.deepEqual(history(events).map(item => [item.operation, item.actor, item.excerpt]), [['created', null, undefined], ['edited', 'worker', 'text'], ['decided', 'user', 'Chose yes']]);
  assert.ok(events.every(event => !JSON.stringify(event.payload).includes('Final answer')));
});

test('question history labels and notes are bounded, stripped of control text and scanned for secrets', () => {
  const hostile = { seq: 2, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'token=abcdef123456 \u001b]8;;http://evil\u0007x', actor: { kind: 'agent', sessionId: 's', lane: '\u001b[31mL0\u001b[0m' + 'x'.repeat(200) } };
  const [entry] = history(questionEvents({ ...fixture.question, rev: 2, history: [...fixture.question.history, hostile] })).slice(1);
  assert.ok(!String(entry.excerpt).includes('abcdef123456'));
  assert.ok(String(entry.actor).length <= 64);
  assert.ok(Array.from(String(entry.actor)).every(char => char.charCodeAt(0) >= 32));
  const long = history(questionEvents({ ...fixture.question, rev: 2, history: [{ seq: 1, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'x'.repeat(5000) }] }))[0];
  assert.equal(String(long.excerpt).length, 200);
});

test('credentials straddling a bound are redacted before truncation, for actor labels and notes', () => {
  const credential = 'https://user:' + 'p'.repeat(51) + '@example.invalid';
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJlbWFpbCI6ImFsaWNlQGNvcnAuZXhhbXBsZSJ9', 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.');
  const note = 'x'.repeat(190) + ' ghp_' + 'a'.repeat(40);
  const events = questionEvents({ ...fixture.question, rev: 2, history: [
    { seq: 1, type: 'comment', ts: '2026-07-01T10:01:00Z', text: note, actor: { kind: 'agent', sessionId: 's', name: credential } },
    { seq: 2, type: 'comment', ts: '2026-07-01T10:02:00Z', actor: { kind: 'agent', sessionId: 's', name: jwt } },
  ] });
  const stored = JSON.stringify(events);
  for (const leak of ['ppppp', 'ghp_', 'aaaaa', 'eyJlbWFpbCI6', 'user:p']) assert.ok(!stored.includes(leak), leak);
  assert.ok(history(events)[0].actor !== null);
});

test('a note cut at the bound carries an explicit truncated signal, a short note does not', () => {
  const [long, short] = history(questionEvents({ ...fixture.question, rev: 2, history: [
    { seq: 1, type: 'comment', ts: '2026-07-01T10:01:00Z', text: 'y'.repeat(500) }, { seq: 2, type: 'comment', ts: '2026-07-01T10:02:00Z', text: 'y'.repeat(200) }] }));
  assert.equal(long.truncated, true);
  assert.equal(String(long.excerpt).length, 200);
  assert.equal('truncated' in short, false);
});

test('a credential in a question id never reaches the stored idempotency key', () => {
  const id = 'ghp_' + 'b'.repeat(40);
  const stored = JSON.stringify(questionEvents({ ...fixture.question, id, rev: 2 }));
  assert.ok(!stored.includes('bbbbbbbb'));
});

test('question records that cannot be represented warn without their content', () => {
  const base = fixture.question;
  for (const bad of [{ ...base, priority: 'low' }, { ...base, v: 2 }, { ...base, rev: 'x' }, { ...base, history: [...base.history, { seq: 1, type: 'created', ts: '2026-07-01T10:00:00Z' }] },
    { ...base, history: [{ seq: 1, type: 'teleported', ts: '2026-07-01T10:00:00Z' }] }, { ...base, history: [{ seq: 1, type: 'created', ts: 'nope' }] }, { ...base, options: 'x' }]) {
    assert.equal(questionEvents(bad)[0].type, 'SourceSchemaUnknown');
  }
  assert.equal(questionEvents({ ...base, history: [], createdAt: '2026-07-01T10:00:00Z' })[0].type, 'QuestionSnapshotObserved');
  assert.equal(questionEvents({ ...base, history: [] })[0].type, 'SourceSchemaUnknown');
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

test('a link whose number would change when truncated gets an ellipsis; a long link whose target survives passes unchanged', async () => {
  const { parseLink } = await import('@pi-console/contract');
  const padded = ' '.repeat(195) + 'a/b#12', survives = 'a/b#12' + ' '.repeat(300);
  const row = { ...fixture.question, links: [padded, survives] };
  const stored = questionEvents(row).find(event => event.type === 'QuestionSnapshotObserved')?.payload.links as string[];
  assert.equal(stored[0].endsWith('\u2026'), true);
  assert.equal(parseLink(stored[0]), null);
  assert.equal(stored[1].endsWith('\u2026'), false);
  assert.equal(parseLink(stored[1])?.key, 'a/b#12');
});

test('links that are not whole recognised references can never parse after truncation or control stripping', async () => {
  const { parseLink } = await import('@pi-console/contract');
  const hostile = ['a/b#1' + ' '.repeat(195) + 'junk', 'a/b#1\u0000', 'a/b#1\u0000'.repeat(3), 'x'.repeat(300), 'plain prose'];
  const row = { ...fixture.question, links: ['a/b#1', 'https://github.com/a/b/pull/2?x=1', ...hostile] };
  const stored = questionEvents(row).find(event => event.type === 'QuestionSnapshotObserved')?.payload.links as string[];
  assert.deepEqual(stored.slice(0, 2), ['a/b#1', 'https://github.com/a/b/pull/2?x=1']);
  for (const link of stored.slice(2)) {
    assert.equal(parseLink(link), null);
    assert.equal(parseLink(link.slice(0, 200).split('\u0000').join('')), null);
  }
});
