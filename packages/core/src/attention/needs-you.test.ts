import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { Projector } from '../projector/projector.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { testEvent } from '../testing/events.ts';
import { needsYou } from './needs-you.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 8, minute)).toISOString();
const ref = { file: '/s1.jsonl', offset: 120, entryId: 'e1' };

async function attention(events: NewEvent[], nowMinute = 10) {
  const log = new SqliteEventLog(':memory:');
  await log.append(events);
  const projector = new Projector(log, consoleProjections());
  await projector.catchUp();
  log.close();
  return needsYou(readModels(projector), { now: new Date(at(nowMinute)) });
}

const request = (n: number, origin: string, minute: number) =>
  testEvent(n, 'RequestObserved', { requestId: `r${n}`, sessionId: 's1', origin, originEvidence: 'spec', excerpt: `ask ${n}`, withheld: false }, { occurredAt: at(minute), refs: ref });

test('open launch and human requests need you; unproven ones never raise a badge', async () => {
  const items = await attention([request(1, 'launch', 1), request(2, 'unproven', 2), request(3, 'human', 3)]);
  assert.deepEqual(items.map(item => [item.reason, item.id]), [['open-request', 'request:r1'], ['open-request', 'request:r3']]);
  assert.deepEqual(items[0].pointer, { sessionId: 's1', entryId: 'e1', fileOffset: 120 });
});

test('answered or interrupted requests no longer need you', async () => {
  const items = await attention([
    request(1, 'launch', 1), request(2, 'launch', 2),
    testEvent(3, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false }, { occurredAt: at(3) }),
    testEvent(4, 'RequestInterrupted', { requestId: 'r2', sessionId: 's1', resetId: null }, { occurredAt: at(4) }),
  ]);
  assert.deepEqual(items, []);
});

test('only open blocking questions need you', async () => {
  const asked = (n: number, blocking: boolean) => testEvent(n, 'QuestionAsked', { questionId: `k${n}`, asker: 'lane-a', kind: 'decision', urgency: 'high', blocking, excerpt: `q${n}` }, { occurredAt: at(n) });
  const items = await attention([asked(1, true), asked(2, false), asked(3, true), testEvent(4, 'QuestionAnswered', { questionId: 'k3' })]);
  assert.deepEqual(items.map(item => [item.reason, item.id, item.sessionId]), [['blocking-question', 'question:k1', null]]);
});

test('a lane waiting on the user needs you; waiting on another lane does not', async () => {
  const status = (n: number, laneId: string, waitingOn: string | null) => testEvent(n, 'LaneStatusChanged', { laneId, status: 'waiting', waitingOn, barredBy: null, parked: false }, { occurredAt: at(n) });
  const items = await attention([status(1, 'a', 'user'), status(2, 'b', 'lane-a'), status(3, 'c', 'owner:sindre'), status(4, 'c', null)]);
  assert.deepEqual(items.map(item => [item.reason, item.laneId]), [['lane-waiting-on-user', 'a']]);
});

test('a running turn silent past the threshold is stale; the clock is a query input only', async () => {
  const events = [testEvent(1, 'TurnStarted', { sessionId: 's1', turnId: 't1' }, { occurredAt: at(0), refs: ref })];
  assert.deepEqual(await attention(events, 10), []);
  const stale = await attention(events, 45);
  assert.deepEqual(stale.map(item => [item.reason, item.sessionId]), [['stale-session', 's1']]);
});
