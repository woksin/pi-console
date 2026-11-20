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
