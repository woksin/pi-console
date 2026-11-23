import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { testEvent } from '../testing/events.ts';
import { Projector } from '../projector/projector.ts';
import { consoleProjections, readModels } from './index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { deltaFor } from '../queries/deltas.ts';

const snapshot = (n: number, revision: number, extra: object = {}) => testEvent(n, 'QuestionSnapshotObserved', {
  questionId: 'q1', revision, asker: null, kind: 'decision', urgency: 'normal', blocking: true, status: 'open', excerpt: `text r${String(revision)}`, options: [],
  links: ['https://example.invalid/i/1'], createdAt: '2026-11-01T00:00:00Z', updatedAt: `2026-11-01T00:0${String(revision)}:00Z`, ...extra,
});
const recorded = (n: number, sequence: number, at: string, extra: object = {}) =>
  testEvent(n, 'QuestionHistoryRecorded', { questionId: 'q1', sequence, operation: 'comment', at, actor: 'L0', excerpt: `note ${String(sequence)}`, withheld: false, ...extra });

async function after(events: NewEvent[]) {
  const log = new SqliteEventLog(':memory:');
  try {
    await log.append(events);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    const queries = new ConsoleQueries(() => readModels(projector), () => new Date('2026-12-01'));
    const deltas = [];
    for await (const event of log.readFrom(0)) { const delta = deltaFor(queries, event); if (delta) deltas.push(delta); }
    return { question: queries.questionById('q1'), list: queries.questions(), deltas };
  } finally { log.close(); }
}

test('history is newest first with sequence breaking equal times, and each entry appears once', async () => {
  const { question } = await after([
    snapshot(1, 2), recorded(2, 1, '2026-11-01T00:00:00Z', { operation: 'created' }), recorded(3, 2, '2026-11-01T00:01:00Z'),
    recorded(4, 3, '2026-11-01T00:01:00Z'), recorded(5, 3, '2026-11-01T00:01:00Z'),
  ]);
  assert.deepEqual(question?.history?.map(entry => entry.sequence), [3, 2, 1]);
  assert.equal(question?.updatedAt, '2026-11-01T00:02:00Z');
});

test('history arriving before its snapshot waits, then every read path carries the same complete question', async () => {
  const { question, list, deltas } = await after([recorded(1, 1, '2026-11-01T00:00:00Z'), recorded(2, 2, '2026-11-01T00:01:00Z'), snapshot(3, 1)]);
  assert.equal(question?.history?.length, 2);
  assert.deepEqual(list, [question]);
  assert.deepEqual(deltas.map(delta => delta.type), Array(3).fill('question.asked'));
  for (const delta of deltas) assert.deepEqual(delta.payload, question);
});

test('the highest revision is current whatever the arrival order, and lifecycle facts never override it', async () => {
  const lifecycle = testEvent(9, 'QuestionAnswered', { questionId: 'q1' });
  const asked = testEvent(0, 'QuestionAsked', { questionId: 'q1', kind: 'question', urgency: 'high', blocking: false, excerpt: 'legacy' });
  const a = await after([snapshot(1, 3, { status: 'deferred' }), snapshot(2, 1), lifecycle]);
  const b = await after([asked, snapshot(2, 1), lifecycle, snapshot(1, 3, { status: 'deferred' })]);
  for (const { question } of [a, b]) {
    assert.deepEqual([question?.text, question?.status, question?.kind], ['text r3', 'deferred', 'decision']);
  }
});

test('legacy-only logs keep the v0 shape without invented history', async () => {
  const { question } = await after([testEvent(1, 'QuestionAsked', { questionId: 'q1', kind: 'question', urgency: 'normal', blocking: false }), testEvent(2, 'QuestionAnswered', { questionId: 'q1' })]);
  assert.equal(question?.status, 'answered');
  assert.deepEqual(Object.keys(question ?? {}).filter(key => ['history', 'updatedAt', 'links'].includes(key)), []);
});

test('a snapshot without history leaves history absent, not empty', async () => {
  const { question } = await after([snapshot(1, 1)]);
  assert.equal(question?.history, undefined);
  assert.deepEqual(question?.links, ['https://example.invalid/i/1']);
});
