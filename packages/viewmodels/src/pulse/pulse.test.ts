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

test('200 sessions aggregate into at most 32 proportional cells without losing any status or count', () => {
  const sessions = Array.from({ length: 200 }, (_, index) => ({ ...fixture.sessions[0], id: String(index), status: index < 120 ? 'working' as const : index < 199 ? 'idle' as const : 'failed' as const }));
  const pulse = pulseViewModel({ sessions, needsYou: 0 });
  assert.ok(pulse.cells.length <= 32);
  assert.equal(pulse.sessions, 200);
  assert.equal(pulse.cells.reduce((sum, cell) => sum + cell.count, 0), 200);
  for (const status of ['working', 'idle', 'failed']) {
    const cells = pulse.cells.filter(cell => cell.status.status === status);
    const count = sessions.filter(session => session.status === status).length;
    assert.equal(cells.reduce((sum, cell) => sum + cell.count, 0), count);
    assert.ok(Math.abs(cells.length / pulse.cells.length - count / sessions.length) < 0.05);
    assert.ok(cells.every(cell => cell.count > 0 && cell.title.includes('sessions')));
  }
  assert.match(pulse.summary, /^200 sessions, 120 working/);
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
