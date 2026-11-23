import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from './sqlite-event-log.ts';
import { eventLogConformance } from './conformance.ts';
import { crashChild, inspectCrashLog } from './crash-harness.ts';
import { testEvent } from '../testing/events.ts';

const directory = mkdtempSync(join(tmpdir(), 'pi-console-log-'));
let files = 0;
const freshPath = () => join(directory, `log-${++files}.db`);

eventLogConformance('SqliteEventLog', () => {
  const log = new SqliteEventLog(freshPath());
  return { log, close: () => { log.close(); } };
});

test('events and checkpoints survive reopening the file', async () => {
  const path = freshPath();
  const first = new SqliteEventLog(path);
  await first.append([testEvent(1, 'SessionHeartbeat', { sessionId: 'a' })]);
  first.close();
  const second = new SqliteEventLog(path);
  assert.equal(second.lastSeq(), 1);
  assert.equal((await second.append([testEvent(1, 'SessionHeartbeat', { sessionId: 'a' })])).appended, 0);
  second.close();
});

test('a process killed mid-append loses nothing and duplicates nothing', async () => {
  const path = freshPath();
  const total = 3000;
  let previous = 0;
  for (const killAfterBatches of [20, 20, 20]) {
    assert.equal(await crashChild(path, total, killAfterBatches), null, 'child was killed, not finished');
    const state = await inspectCrashLog(path);
    assert.ok(state.events > previous, 'each run resumes and makes progress');
    previous = state.events;
    assert.equal(state.events, state.distinct, 'no duplicate events');
    assert.equal(state.events, state.checkpoint, 'checkpoint and events commit together');
    assert.equal(state.maxOffset, state.checkpoint, 'no event beyond the checkpoint');
  }
  assert.equal(await crashChild(path, total), 0);
  const final = await inspectCrashLog(path);
  assert.deepEqual(final, { events: total, distinct: total, checkpoint: total, maxOffset: total });
});

test('a large append reaches subscribers in slices across macrotasks, once and in order', async () => {
  const log = new SqliteEventLog(':memory:', { sliceEvents: 100 });
  try {
    const seen: number[] = [];
    const perTurn: number[] = [0];
    let ticking = true;
    const tick = (): void => { perTurn.push(0); if (ticking) setImmediate(tick); };
    log.subscribe(0, event => { seen.push(event.seq); perTurn[perTurn.length - 1]++; });
    await new Promise(resolve => setImmediate(resolve));
    setImmediate(tick);
    await log.append(Array.from({ length: 1_000 }, (_, n) => testEvent(n + 1, 'SessionHeartbeat', { sessionId: 's1' })));
    while (seen.length < 1_000) await new Promise(resolve => setImmediate(resolve));
    ticking = false;
    assert.deepEqual(seen, Array.from({ length: 1_000 }, (_, n) => n + 1));
    assert.ok(Math.max(...perTurn) <= 100, `max ${Math.max(...perTurn)} events in one turn`);
  } finally { log.close(); }
});

test('readFrom yields to the event loop every slice, in order, once, honouring the limit', async () => {
  for (const pageSize of [30, 500]) {
    const log = new SqliteEventLog(':memory:', { sliceEvents: 100, pageSize });
    try {
      await log.append(Array.from({ length: 1_050 }, (_, n) => testEvent(n + 1, 'SessionHeartbeat', { sessionId: 's1' })));
      const perTurn: number[] = [0];
      let ticking = true;
      const tick = (): void => { perTurn.push(0); if (ticking) setImmediate(tick); };
      setImmediate(tick);
      let timer = false;
      setTimeout(() => { timer = true; }, 0);
      const seen: number[] = [];
      let timerBeforeEnd = false;
      for await (const event of log.readFrom(0)) {
        seen.push(event.seq);
        perTurn[perTurn.length - 1]++;
        timerBeforeEnd ||= timer && seen.length < 1_050;
      }
      ticking = false;
      assert.deepEqual(seen, Array.from({ length: 1_050 }, (_, n) => n + 1));
      assert.ok(Math.max(...perTurn) <= 100, `page ${pageSize}: max ${Math.max(...perTurn)} events in one turn`);
      assert.ok(timerBeforeEnd, 'a zero-delay timer ran before replay completed');
      const limited: number[] = [];
      for await (const event of log.readFrom(250, 130)) limited.push(event.seq);
      assert.deepEqual(limited, Array.from({ length: 130 }, (_, n) => n + 251));
      for await (const event of log.readFrom(1_049)) assert.equal(event.seq, 1_050);
      for await (const event of log.readFrom(0)) { assert.equal(event.seq, 1); break; }
    } finally { log.close(); }
  }
});
