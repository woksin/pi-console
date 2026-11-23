import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { startsNewDay, timeDisplay } from './time.ts';
import { clock } from './format.ts';

test('UTC display: clock, day and absolute time', () => {
  assert.deepEqual(timeDisplay('2026-11-20T09:15:07Z', 'UTC'), { clock: '09:15:07', dayKey: '2026-11-20', date: '20 Nov 2026', absolute: '20 Nov 2026 09:15:07 UTC' });
});

test('a non-UTC zone moves the clock and the calendar day, with its offset and zone name', () => {
  const oslo = timeDisplay('2026-11-20T23:30:00Z', 'Europe/Oslo');
  assert.deepEqual(oslo, { clock: '00:30:00', dayKey: '2026-11-21', date: '21 Nov 2026', absolute: '21 Nov 2026 00:30:00 UTC+01:00 (Europe/Oslo)' });
  assert.equal(timeDisplay('2026-11-20T03:00:00Z', 'America/Los_Angeles').date, '19 Nov 2026');
});

test('local midnight differs from UTC midnight and the year turns with the zone', () => {
  assert.equal(startsNewDay('2026-12-31T22:59:59Z', '2026-12-31T23:00:00Z', 'Europe/Oslo'), true);
  assert.equal(startsNewDay('2026-12-31T22:59:59Z', '2026-12-31T23:00:00Z', 'UTC'), false);
  assert.equal(timeDisplay('2026-12-31T23:00:00Z', 'Europe/Oslo').date, '1 Jan 2027');
});

test('offset-bearing input is normalised to the zone', () => {
  assert.equal(timeDisplay('2026-11-20T23:30:00-05:00', 'UTC').absolute, '21 Nov 2026 04:30:00 UTC');
});

test('the repeated DST hour has equal clocks but distinct offsets', () => {
  const first = timeDisplay('2026-11-01T08:30:00Z', 'America/Los_Angeles');
  const second = timeDisplay('2026-11-01T09:30:00Z', 'America/Los_Angeles');
  assert.equal(first.clock.slice(0, 5), '01:30');
  assert.equal(second.clock.slice(0, 5), '01:30');
  assert.match(first.absolute, /UTC-07:00/);
  assert.match(second.absolute, /UTC-08:00/);
  assert.equal(first.dayKey, second.dayKey);
});

test('invalid input yields the dash convention without throwing', () => {
  assert.deepEqual(timeDisplay('nope', 'UTC'), { clock: '–', dayKey: '', date: '–', absolute: '–' });
  assert.equal(clock('nope'), '–');
});

test('the first displayed item starts a day; same-day neighbours do not', () => {
  assert.equal(startsNewDay(undefined, '2026-11-20T09:00:00Z', 'UTC'), true);
  assert.equal(startsNewDay('2026-11-20T00:00:00Z', '2026-11-20T23:59:59Z', 'UTC'), false);
  assert.equal(startsNewDay('2026-11-20T23:59:59Z', '2026-11-21T00:00:00Z', 'UTC'), true);
});

test('the production default is the viewer zone, not UTC', () => {
  const script = "import('./time.ts').then(m => console.log(m.timeDisplay('2026-11-20T03:00:00Z').absolute))";
  const run = (zone: string) => execFileSync(process.execPath, ['--input-type=commonjs', '-e', script], { cwd: import.meta.dirname, env: { ...process.env, TZ: zone }, encoding: 'utf8' }).trim();
  assert.equal(run('America/Los_Angeles'), '19 Nov 2026 19:00:00 UTC-08:00 (America/Los_Angeles)');
  assert.equal(run('UTC'), '20 Nov 2026 03:00:00 UTC');
});
