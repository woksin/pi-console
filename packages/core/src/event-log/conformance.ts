import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventEnvelope, EventLog, SourceCheckpoint } from '@pi-console/contract';
import { testEvent } from '../testing/events.ts';

/** A fresh, empty log for one conformance case. */
export interface EventLogHarness { log: EventLog; close(): void }

const heartbeat = (n: number) => testEvent(n, 'SessionHeartbeat', { sessionId: `s${n}`, status: 'ok' });

const checkpoint = (offset: number): SourceCheckpoint => ({
  source: 'session-jsonl', identity: 'dev:1:ino:2', generation: 0, offset, path: '/x.jsonl', size: offset, mtimeMs: 1,
});

async function collect(iterable: AsyncIterable<EventEnvelope>): Promise<EventEnvelope[]> {
  const events: EventEnvelope[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function withLog(create: () => EventLogHarness, body: (log: EventLog) => Promise<void>): Promise<void> {
  const harness = create();
  try { await body(harness.log); } finally { harness.close(); }
}

/**
 * The `EventLog` port contract (ADR-0001). Every adapter (SQLite now, Chronicle later) must pass it unchanged.
 * Call at the top level of a spec file.
 */
export function eventLogConformance(name: string, create: () => EventLogHarness): void {
  const spec = (title: string, body: (log: EventLog) => Promise<void>): void => {
    void test(`${name}: ${title}`, () => withLog(create, body));
  };

  spec('appends in order with increasing seq', async log => {
    const result = await log.append([heartbeat(1), heartbeat(2), heartbeat(3)]);
    assert.deepEqual(result, { appended: 3, duplicates: 0, lastSeq: 3 });
    const events = await collect(log.readFrom(0));
    assert.deepEqual(events.map(event => event.seq), [1, 2, 3]);
    assert.deepEqual(events[1].payload, { sessionId: 's2', status: 'ok' });
  });

  spec('a duplicate append is a no-op', async log => {
    await log.append([heartbeat(1), heartbeat(2)]);
    const again = await log.append([heartbeat(2), heartbeat(1), heartbeat(3)]);
    assert.deepEqual(again, { appended: 1, duplicates: 2, lastSeq: 3 });
    assert.equal((await collect(log.readFrom(0))).length, 3);
  });

  spec('readFrom honours afterSeq and limit', async log => {
    await log.append([1, 2, 3, 4, 5].map(heartbeat));
    assert.deepEqual((await collect(log.readFrom(2, 2))).map(event => event.seq), [3, 4]);
  });

  spec('checkpoints are stored with the events and replaced per identity', async log => {
    await log.append([heartbeat(1)], [checkpoint(10)]);
    await log.append([heartbeat(2)], [checkpoint(20)]);
    assert.deepEqual(await log.checkpoints('session-jsonl'), [checkpoint(20)]);
    assert.deepEqual(await log.checkpoints('other'), []);
  });

  spec('an invalid event rejects the whole batch including checkpoints', async log => {
    const broken = { ...heartbeat(2), id: 'not-a-uuid' };
    await assert.rejects(log.append([heartbeat(1), broken], [checkpoint(30)]));
    assert.deepEqual(await collect(log.readFrom(0)), []);
    assert.deepEqual(await log.checkpoints('session-jsonl'), []);
  });

  spec('subscribe delivers the backlog then live events, once each, in order', async log => {
    await log.append([heartbeat(1), heartbeat(2)]);
    const seen: number[] = [];
    const unsubscribe = log.subscribe(1, event => seen.push(event.seq));
    await new Promise(resolve => setImmediate(resolve));
    await log.append([heartbeat(3), heartbeat(3)]);
    await log.append([heartbeat(4)]);
    await new Promise(resolve => setImmediate(resolve));
    unsubscribe();
    await log.append([heartbeat(5)]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [2, 3, 4]);
  });
}
