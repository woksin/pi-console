import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brailleSparkline, fleetActivity, pulseViewModel } from './pulse.ts';
import { fixture } from '../test-support.ts';

test('one cell per session, most urgent first, like statuses in one run', () => {
  const pulse = pulseViewModel({ sessions: fixture.sessions, needsYou: 16 });
  assert.equal(pulse.cells.length, fixture.sessions.length);
  const statuses = pulse.cells.map(cell => cell.status.status);
  assert.equal(statuses[0], 'needs-you');
  assert.equal(new Set(statuses).size, statuses.filter((status, at) => status !== statuses[at - 1]).length, 'each status forms one contiguous run');
  assert.ok(pulse.cells.every(cell => cell.status.glyph && cell.status.color && cell.title.includes('/')));
  assert.match(pulse.summary, /^30 sessions, \d+ working, 16 need you; .+ tokens in the last minute$/);
});

test('activity buckets tokens per minute up to the newest sample', () => {
  const session = { ...fixture.sessions[0], samples: [
    { at: '2026-11-20T09:00:10Z', contextPercent: 1, tokens: 5, costUsd: 0 }, { at: '2026-11-20T09:00:50Z', contextPercent: 1, tokens: 7, costUsd: 0 },
    { at: '2026-11-20T09:02:00Z', contextPercent: 1, tokens: 3, costUsd: 0 },
  ] };
  assert.deepEqual(fleetActivity([session], 3), [12, 0, 3]);
  assert.deepEqual(fleetActivity([], 2), [0, 0]);
  assert.equal(pulseViewModel({ sessions: fixture.sessions, needsYou: 0 }).activity.length, 24);
});

test('the braille sparkline packs two values per character, bottom-up, with a dot for any activity', () => {
  assert.equal(brailleSparkline([0, 0]), '⠀');
  assert.equal(brailleSparkline([4, 4]), '⣿');
  assert.equal(brailleSparkline([1, 0, 4], 4), '⡀⡇');
  assert.equal(brailleSparkline([0.01, 4]), '⣸');
  assert.equal(brailleSparkline([1, 2, 3, 4, 5]).length, 3);
});
