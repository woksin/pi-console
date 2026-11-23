import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewEvent } from '@pi-console/contract';
import { consoleProjections, ConsoleQueries, Projector, readModels, SqliteEventLog, type Delta, type ReadModels } from '@pi-console/core';
import { syntheticModels, testEvent } from '@pi-console/core/testing';
import { sessionStarted } from '../testing/harness.ts';
import { DeltaBatcher } from './delta-batcher.ts';

function history(models: ReadModels, count: number): void {
  const width = Math.floor(count / 6);
  const seed = syntheticModels({ sessions: count - 1, jobs: width, requests: width, questions: width, messages: 0 });
  Object.assign(models.sessions.sessions, seed.sessions.sessions);
  Object.assign(models.work.jobs, seed.work.jobs);
  Object.assign(models.requests.requests, seed.requests.requests);
  Object.assign(models.questions.questions, seed.questions.questions);
  for (let n = 0; n < width; n++) {
    const id = `historic:${n}`;
    models.memory.items[id] = {
      id, recorded: true, kind: 'directive', scopeKind: 'session', scopeKey: 's0000000', sourceType: 'user_message', sourceMessageId: null,
      authorityMode: 'none', excerpt: '', withheld: false, at: '2020-01-01T00:00:00Z', status: 'done', statusBasis: 'recorded', transitions: [], stamps: {},
    };
    models.memory.messages[id] = { id, recorded: true, sessionId: 's0000000', origin: 'human', at: '', classified: true, itemIds: [], stamps: {} };
  }
}

function observed(models: ReadModels) {
  let recording = false;
  let reads = 0;
  let enumerations = 0;
  const watch = <T extends object>(rows: T): T => new Proxy(rows, {
    get(target, key, receiver) { if (recording) reads++; return Reflect.get(target, key, receiver); },
    ownKeys(target) { if (recording) enumerations++; return Reflect.ownKeys(target); },
  });
  const view: ReadModels = {
    ...models, sessions: { sessions: watch(models.sessions.sessions) }, requests: { requests: watch(models.requests.requests) },
    questions: { questions: watch(models.questions.questions) }, memory: { items: watch(models.memory.items), messages: watch(models.memory.messages) },
    work: { ...models.work, jobs: watch(models.work.jobs) },
  };
  return { view, start() { reads = 0; enumerations = 0; recording = true; }, stop() { recording = false; return { reads, enumerations }; } };
}

async function measure(count: number) {
  const log = new SqliteEventLog(':memory:');
  const projector = new Projector(log, consoleProjections());
  const now = () => new Date('2026-11-20T08:10:00Z');
  await log.append([
    sessionStarted(1, 's1'),
    testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'human', originEvidence: 'spec' }),
    testEvent(3, 'QuestionAsked', { questionId: 'q1', asker: 's1', kind: 'question', urgency: 'normal', blocking: true, excerpt: 'old' }),
    testEvent(4, 'JobStarted', { jobId: 'j1', sessionId: 's1', kind: 'job', name: 'job' }),
    testEvent(5, 'MemoryItemRecorded', { itemId: 'i1', kind: 'order', scopeKind: 'session', scopeKey: 's1', sourceType: 'user_message', sourceMessageId: null, authorityMode: 'none', supersedes: [], excerpt: 'item', withheld: false }),
  ]);
  await projector.start();
  const models = readModels(projector);
  history(models, count);
  assert.equal(Object.keys(models.sessions.sessions).length, count);
  const work = observed(models);
  const full = new ConsoleQueries(() => models, now);
  let deltas: Delta[] = [];
  const batcher = new DeltaBatcher(() => work.view, delta => deltas.push(delta), now);
  projector.onApplied((event, changes) => { batcher.add(event, changes); });
  const events: Record<string, NewEvent> = {
    heartbeat: testEvent(6, 'SessionHeartbeat', { sessionId: 's1' }),
    answer: testEvent(7, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false }),
    question: testEvent(8, 'QuestionRevised', { questionId: 'q1', excerpt: 'new' }),
    job: testEvent(9, 'JobFinished', { jobId: 'j1', status: 'done', exitCode: 0 }),
    memory: testEvent(10, 'MemoryItemConfirmed', { itemId: 'i1', actorKind: 'human', reasonExcerpt: '' }),
    rawPrompt: testEvent(11, 'RequestObserved', { raw: true, sessionId: 's1', entryId: 'p1', requestId: 'raw', origin: 'unproven', originEvidence: 'spec' }),
    rawAnswer: testEvent(12, 'AnswerObserved', { raw: true, sessionId: 's1', entryId: 'a2', answerId: 'a2', interim: false, excerpt: 'answer', withheld: false }),
    reset: testEvent(13, 'ResetOccurred', { sessionId: 's1', resetId: 'reset', kind: 'compaction' }),
  };
  const result: Record<string, { reads: number; enumerations: number; deltas: number }> = {};
  try {
    for (const [name, event] of Object.entries(events)) {
      deltas = [];
      await log.append([event]);
      work.start();
      batcher.flush();
      const measured = work.stop();
      assert.equal(measured.enumerations, 0, `${name} must not enumerate a historical collection`);
      for (const delta of deltas) {
        const payload = delta.payload as { id: string; memoryChanged?: boolean };
        if (delta.type === 'session.updated') {
          assert.deepEqual({ ...payload, memoryChanged: undefined }, { ...full.sessionById(payload.id), memoryChanged: undefined });
        }
        if (delta.type === 'request.observed') assert.deepEqual(payload, full.requestById(payload.id));
        if (delta.type === 'question.asked') assert.deepEqual(payload, full.questionById(payload.id));
        if (delta.type === 'job.finished') assert.deepEqual(payload, full.jobById(payload.id));
        if (delta.type === 'reset.occurred') assert.deepEqual(payload, full.resetById(payload.id));
      }
      result[name] = { ...measured, deltas: deltas.length };
    }
  } finally { batcher.flush(); projector.stop(); log.close(); }
  return result;
}

test('ordinary flush work is independent of 1k versus 30k sessions', async t => {
  const small = await measure(1_000);
  const large = await measure(30_000);
  assert.deepEqual(large, small);
  t.diagnostic(JSON.stringify({ sessions1000: small, sessions30000: large }));
});
