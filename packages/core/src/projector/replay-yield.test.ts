import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { testEvent } from '../testing/events.ts';
import { Projector } from './projector.ts';
import type { Projection } from './projection.ts';

const counter: Projection<{ seen: number[] }> = {
  name: 'counter', version: 1, initial: () => ({ seen: [] }),
  apply(state, event) { state.seen.push(event.seq); return state; },
};

test('catch-up lets timers run between bounded slices and ends with the same state as a single pass', async () => {
  const log = new SqliteEventLog(':memory:', { sliceEvents: 50 });
  try {
    await log.append(Array.from({ length: 400 }, (_, n) => testEvent(n + 1, 'SessionHeartbeat', { sessionId: 's' })));
    const projector = new Projector(log, [counter]);
    let applied = 0;
    projector.onApplied(() => { applied++; });
    let atTimer = -1;
    setTimeout(() => { atTimer = (projector.state('counter') as { seen: number[] }).seen.length; }, 0);
    await projector.start();
    projector.stop();
    const { seen } = projector.state('counter') as { seen: number[] };
    assert.deepEqual(seen, Array.from({ length: 400 }, (_, n) => n + 1));
    assert.ok(atTimer > 0 && atTimer < 400, `timer observed ${atTimer} events applied`);
    assert.equal(projector.position, 400);
    assert.equal(applied, 0, 'catch-up events are not live notifications');
  } finally { log.close(); }
});
