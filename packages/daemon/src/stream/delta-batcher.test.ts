import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEvent, Request, Session } from '@pi-console/contract';
import { consoleProjections, Projector, readModels, SqliteEventLog, type Delta } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { sessionStarted } from '../testing/harness.ts';
import { DeltaBatcher } from './delta-batcher.ts';

async function batchSpec() {
  const log = new SqliteEventLog(':memory:');
  await log.append([sessionStarted(1, 's1'), sessionStarted(2, 's2')]);
  const projector = new Projector(log, consoleProjections());
  await projector.catchUp();
  const deltas: Delta[] = [];
  const batcher = new DeltaBatcher(() => readModels(projector), delta => deltas.push(delta), () => new Date('2026-01-01'));
  return {
    log,
    async apply(events: NewEvent[]) {
      deltas.length = 0;
      const position = projector.position;
      await log.append(events);
      await projector.catchUp();
      for await (const event of log.readFrom(position)) batcher.add(event);
      batcher.flush();
      return [...deltas];
    },
  };
}

const request = (n: number, sessionId: string) => testEvent(n, 'RequestObserved', {
  requestId: 'r1', sessionId, origin: 'launch', originEvidence: 'spec', excerpt: 'request',
});

test('reassigning an open request emits its entity plus both changed session owners', async () => {
  const spec = await batchSpec();
  try {
    await spec.apply([request(3, 's1')]);
    const deltas = await spec.apply([request(4, 's2')]);
    assert.deepEqual(deltas.map(delta => delta.type), ['request.observed', 'session.updated', 'session.updated']);
    assert.deepEqual(deltas.slice(1).map(delta => {
      const { id, status } = delta.payload as Session;
      return { id, status };
    }), [{ id: 's1', status: 'idle' }, { id: 's2', status: 'needs-you' }]);
  } finally { spec.log.close(); }
});

test('coalescing publishes only the final entity and net derived changes, not snapshots or redundant sessions', async () => {
  const spec = await batchSpec();
  try {
    const deltas = await spec.apply([request(3, 's1'), testEvent(4, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false })]);
    assert.deepEqual(deltas.map(delta => delta.type), ['request.observed']);
    assert.equal((deltas[0].payload as { status: string }).status, 'answered');
    const heartbeat = await spec.apply([testEvent(5, 'SessionHeartbeat', { sessionId: 's1' })]);
    assert.deepEqual(heartbeat.map(delta => delta.type), ['session.updated']);
  } finally { spec.log.close(); }
});

for (const [type, payload, status] of [
  ['AnswerObserved', { raw: true, sessionId: 's1', entryId: 'a1', answerId: 's1:a1', excerpt: 'answer', withheld: false, interim: false }, 'answered'],
  ['RequestInterrupted', { raw: true, sessionId: 's1', entryId: 'abort', reason: 'aborted' }, 'interrupted'],
  ['ResetOccurred', { sessionId: 's1', resetId: 'reset', kind: 'compaction' }, 'interrupted'],
  ['SessionEnded', { sessionId: 's1', reason: 'done' }, 'unanswered'],
] as const) {
  test(`${type} without a requestId publishes every changed raw request once`, async () => {
    const spec = await batchSpec();
    try {
      await spec.apply([3, 4].map(n => testEvent(n, 'RequestObserved', {
        raw: true, sessionId: 's1', entryId: `p${n}`, requestId: `s1:p${n}`, excerpt: `prompt ${n}`,
        origin: 'unproven', originEvidence: 'spec',
      })));
      const deltas = await spec.apply([testEvent(5, type, payload)]);
      const requests = deltas.filter(delta => delta.type.startsWith('request.'));
      assert.equal(requests.length, 2);
      assert.deepEqual(requests.map(delta => delta.type), Array(2).fill(status === 'interrupted' ? 'request.interrupted' : 'request.observed'));
      assert.deepEqual(requests.map(delta => (delta.payload as Request).id), ['s1:p3', 's1:p4']);
      for (const delta of requests) {
        const request = delta.payload as Request;
        assert.equal(request.status, status);
        if (status === 'answered') assert.equal(request.answer?.id, 's1:a1');
        if (type === 'ResetOccurred') assert.equal(request.resetId, 'reset');
      }
      const heartbeat = await spec.apply([testEvent(6, 'SessionHeartbeat', { sessionId: 's1' })]);
      assert.deepEqual(heartbeat.map(delta => delta.type), ['session.updated']);
    } finally { spec.log.close(); }
  });
}

test('a reset publishes an answered request whose state changed without a status change', async () => {
  const spec = await batchSpec();
  try {
    await spec.apply([
      testEvent(3, 'RequestObserved', { raw: true, sessionId: 's1', entryId: 'p1', requestId: 'r1', origin: 'unproven', originEvidence: 'spec' }),
      testEvent(4, 'AnswerObserved', { raw: true, sessionId: 's1', entryId: 'a1', answerId: 'a1', interim: false, excerpt: 'answer', withheld: false }),
    ]);
    const deltas = await spec.apply([testEvent(5, 'ResetOccurred', { sessionId: 's1', resetId: 'reset', kind: 'compaction' })]);
    assert.deepEqual(deltas.map(delta => delta.type), ['reset.occurred', 'request.observed', 'session.updated']);
    assert.equal((deltas[2].payload as { memoryChanged: boolean }).memoryChanged, true);
    const request = deltas[1].payload as Request;
    assert.equal(request.status, 'answered');
    assert.equal(request.answerPossiblyUnseen, true);
  } finally { spec.log.close(); }
});

test('changing attention items emits a session delta even when status remains needs-you', async () => {
  const spec = await batchSpec();
  try {
    await spec.apply([testEvent(3, 'QuestionAsked', { questionId: 'q1', asker: 's1', kind: 'question', urgency: 'normal', blocking: true, excerpt: 'old' })]);
    const deltas = await spec.apply([testEvent(4, 'QuestionRevised', { questionId: 'q1', excerpt: 'new' })]);
    assert.deepEqual(deltas.map(delta => delta.type), ['question.asked', 'session.updated']);
    assert.equal((deltas[1].payload as { status: string }).status, 'needs-you');
  } finally { spec.log.close(); }
});

test('after an expensive flush the next one waits, coalescing to the same final states', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setImmediate'] });
  const log = new SqliteEventLog(':memory:');
  try {
    await log.append([sessionStarted(1, 's1')]);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    let clock = 0;
    const flushes: Delta[][] = [];
    // Publishing one delta costs 5 ms of the injected clock.
    const batcher = new DeltaBatcher(() => readModels(projector), delta => { clock += 5; flushes.at(-1)?.push(delta); }, () => new Date('2026-01-01'), {
      clock: () => clock,
    });
    const publish = async (events: NewEvent[]) => {
      const position = projector.position;
      await log.append(events);
      await projector.catchUp();
      for await (const event of log.readFrom(position)) batcher.add(event);
    };
    flushes.push([]);
    await publish([request(2, 's1')]);
    t.mock.timers.tick(0);
    assert.deepEqual(flushes[0].map(delta => delta.type), ['request.observed', 'session.updated']);
    flushes.push([]);
    await publish([testEvent(3, 'SessionHeartbeat', { sessionId: 's1' })]);
    t.mock.timers.tick(1);
    assert.equal(flushes[1].length, 0, 'a flush of 10 ms holds the next for 40 ms');
    await publish([testEvent(4, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false })]);
    t.mock.timers.tick(38);
    assert.equal(flushes[1].length, 0);
    t.mock.timers.tick(1);
    assert.deepEqual(flushes[1].map(delta => delta.type), ['session.updated', 'request.observed']);
    assert.equal((flushes[1][1].payload as { status: string }).status, 'answered');
  } finally { log.close(); }
});
