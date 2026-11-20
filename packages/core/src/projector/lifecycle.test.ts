import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { deltaFor } from '../queries/deltas.ts';
import { testEvent } from '../testing/events.ts';
import { canonicalJson } from './canonical.ts';
import { MemoryProjectionStore } from './projection.ts';
import { Projector } from './projector.ts';

const start = testEvent(1, 'SessionStarted', { sessionId: 's1', cwd: '/repo', model: null, role: 'main', parentSessionId: null });
const asked = testEvent(2, 'QuestionAsked', { questionId: 'q1', asker: 's1', kind: 'question', urgency: 'normal', blocking: true, excerpt: 'old' });
const observed = testEvent(3, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'human', originEvidence: 'spec', excerpt: 'request' });

async function project(events: readonly NewEvent[]) {
  const log = new SqliteEventLog(':memory:');
  await log.append(events);
  const store = new MemoryProjectionStore();
  const projector = new Projector(log, consoleProjections(), store);
  await projector.catchUp();
  const queries = new ConsoleQueries(() => readModels(projector), () => new Date(start.occurredAt));
  return { log, store, projector, queries };
}

const lifecycle = [start,
  testEvent(4, 'TurnStarted', { sessionId: 's1', turnId: 't1' }),
  testEvent(5, 'TurnEnded', { sessionId: 's1', turnId: 't1', aborted: false }),
  asked, testEvent(6, 'QuestionRevised', { questionId: 'q1', excerpt: 'new' }),
  testEvent(7, 'QuestionAnswered', { questionId: 'q1' }), observed,
  testEvent(8, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false, excerpt: 'answer' }),
  testEvent(9, 'SessionEnded', { sessionId: 's1', reason: 'done' }),
];

test('lifecycle facts converge by occurredAt across reverse delivery, ties, snapshots and replay', async () => {
  const chronological = [...lifecycle].sort((a, b) => `${a.occurredAt}|${a.id}`.localeCompare(`${b.occurredAt}|${b.id}`));
  const expected = await project(chronological);
  try {
    for (const events of [[...chronological].reverse(), [...lifecycle.slice(4), ...lifecycle.slice(0, 4)]]) {
      const actual = await project(events);
      try {
        assert.equal(canonicalJson(readModels(actual.projector)), canonicalJson(readModels(expected.projector)));
        assert.equal(actual.queries.questions()[0].text, 'new');
        assert.equal(actual.queries.questions()[0].status, 'answered');
        assert.equal(actual.queries.requests()[0].status, 'answered');
        assert.equal(readModels(actual.projector).sessions.sessions.s1.openTurnId, null);
        actual.projector.flush();
        const restored = new Projector(actual.log, consoleProjections(), actual.store);
        await restored.start(); restored.stop();
        assert.equal(canonicalJson(readModels(restored)), canonicalJson(readModels(expected.projector)));
        const replayed = new Projector(actual.log, consoleProjections());
        await replayed.catchUp();
        assert.equal(canonicalJson(readModels(replayed)), canonicalJson(readModels(expected.projector)));
      } finally { actual.log.close(); }
    }
  } finally { expected.log.close(); }
});

test('timestamped lifecycle placeholders survive a restart before their older creation facts arrive', async () => {
  const ordered = [...lifecycle].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const spec = await project(ordered.slice(5));
  const expected = await project(ordered);
  try {
    assert.equal(spec.queries.questions().length, 0);
    assert.equal(spec.queries.requests().length, 0);
    spec.projector.flush();
    const restored = new Projector(spec.log, consoleProjections(), spec.store);
    await restored.start(); restored.stop();
    await spec.log.append(ordered.slice(0, 5).reverse());
    await restored.catchUp();
    assert.equal(canonicalJson(readModels(restored)), canonicalJson(readModels(expected.projector)));
  } finally { spec.log.close(); expected.log.close(); }
});

test('an old turn end cannot close a newer turn and an end-before-start stays closed', async () => {
  const events = [start,
    testEvent(4, 'TurnStarted', { sessionId: 's1', turnId: 'old' }),
    testEvent(5, 'TurnEnded', { sessionId: 's1', turnId: 'old', aborted: false }),
    testEvent(6, 'TurnStarted', { sessionId: 's1', turnId: 'new' }),
  ];
  for (const order of [events, [events[0], events[3], events[2], events[1]]]) {
    const spec = await project(order);
    try { assert.equal(spec.queries.sessions()[0].status, 'working'); }
    finally { spec.log.close(); }
  }
});

test('same-time question and request terminal facts survive late creation with id tie-breaks', async () => {
  const events = [asked, observed,
    testEvent(10, 'QuestionClosed', { questionId: 'q1' }, { occurredAt: asked.occurredAt }),
    testEvent(11, 'RequestInterrupted', { requestId: 'r1', sessionId: 's1', resetId: 'reset' }, { occurredAt: observed.occurredAt }),
  ];
  const spec = await project(events.reverse());
  try {
    assert.equal(spec.queries.questions()[0].status, 'closed');
    assert.equal(spec.queries.requests()[0].status, 'interrupted');
    assert.equal(spec.queries.requests()[0].resetId, 'reset');
  } finally { spec.log.close(); }
});

test('request, answer and question events retain entity deltas while derived status and needs-you change', async () => {
  const spec = await project([start]);
  try {
    for (const [event, status, count] of [
      [observed, 'needs-you', 1],
      [testEvent(4, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false }), 'idle', 0],
      [asked, 'needs-you', 1],
      [testEvent(5, 'QuestionAnswered', { questionId: 'q1' }), 'idle', 0],
    ] as const) {
      await spec.log.append([event]); await spec.projector.catchUp();
      const envelopes = [];
      for await (const envelope of spec.log.readFrom(0)) envelopes.push(envelope);
      const delta = deltaFor(spec.queries, envelopes.at(-1)!);
      assert.equal(delta?.type, event.type.startsWith('Question') ? 'question.asked' : 'request.observed');
      assert.deepEqual(delta?.payload, event.type.startsWith('Question') ? spec.queries.questions()[0] : spec.queries.requests()[0]);
      assert.equal(spec.queries.sessions()[0].status, status);
      assert.equal(spec.queries.needsYou().length, count);
      assert.equal(spec.queries.overview().needsYou.length, count);
    }
  } finally { spec.log.close(); }
});
