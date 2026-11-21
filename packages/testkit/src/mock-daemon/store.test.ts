import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from './store.ts';

type Entry = { cursor: number; at: string; sessionId: string };

const ascending = (entries: readonly Entry[]): boolean => entries.every((entry, at) => at === 0 || Date.parse(entry.at) >= Date.parse(entries[at - 1].at));

/**
 * The mock replays its fixture timeline in laps. A replayed transcript entry used to keep the fixture's own timestamp, so the live
 * tail showed 09:00:00 straight after 09:05:59: an ordering artefact of the mock, not a reset boundary.
 */
test('replayed transcript entries keep time rising with the cursor across laps', async () => {
  const store = createStore(50_000);
  try {
    await delay(150);
    const transcript = (store.fixture.transcript as Entry[]).filter(entry => entry.sessionId === 's2');
    assert.ok(transcript.length > 2000, 'at least one replayed entry was published');
    assert.ok(ascending(transcript), 'an entry is stamped earlier than the one before it');
  } finally {
    store.close();
  }
});

test('the stress stream keeps time rising too', async () => {
  const store = createStore(1, 30_000);
  try {
    await delay(150);
    const transcript = store.fixture.transcript as Entry[];
    assert.ok(transcript.length > 2000);
    assert.ok(ascending(transcript));
  } finally {
    store.close();
  }
});
