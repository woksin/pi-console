import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './testing/harness.ts';

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness.stop(); });

const go = async (key: string, expect: string) => { await harness.ui.press(key); return await harness.ui.waitFor(expect); };

test('boots against the mock daemon: header, attention count, live link and footer hints', () => {
  const frame = harness.ui.frame();
  assert.match(frame, /π console/);
  assert.match(frame, /\d+ need you/);
  assert.match(frame, /◉ live/);
  assert.match(frame, /j\/k move/);
});

test('number keys reach every section', async () => {
  const titles: [string, string][] = [['2', 'Fleet ·'], ['3', 'Requests'], ['4', 'Questions'], ['5', 'Messages'], ['6', 'Timeline'], ['7', 'Work ·'], ['1', 'Fleet']];
  for (const [key, title] of titles) assert.ok((await go(key, title)).length > 0, key);
});

test('clicking a tab switches section', async () => {
  const frame = harness.ui.frame().split('\n')[0];
  await harness.ui.click(frame.indexOf('Fleet') + 1, 0);
  await harness.ui.waitFor('Fleet ·');
});

test('fleet: j/k move the cursor, enter opens the transcript, esc returns', async () => {
  await go('2', 'Fleet ·');
  await harness.ui.press('j'); await harness.ui.press('j'); await harness.ui.press('k');
  await harness.ui.press('RETURN');
  const detail = await harness.ui.waitFor('Transcript');
  assert.match(detail, /following tail|paused/);
  assert.match(detail, /f follow/);
  await harness.ui.press('f');
  await harness.ui.waitFor('paused');
  await harness.ui.press('ESCAPE');
  await harness.ui.waitFor('Fleet ·');
});

test('palette: opens, filters by typing, runs a command and closes', async () => {
  await harness.ui.press(':');
  await harness.ui.waitFor('Command palette');
  await harness.ui.type('work');
  await harness.ui.press('RETURN');
  const frame = await harness.ui.waitFor('Work ·');
  assert.ok(!frame.includes('Command palette'));
  await harness.ui.press('1');
});

test('palette: @ finds sessions and opens one', async () => {
  await harness.ui.press(':');
  await harness.ui.type('@');
  await harness.ui.press('RETURN');
  await harness.ui.waitFor('Transcript');
  await harness.ui.press('ESCAPE');
});

test('fleet filter updates while typing, cancels edits, commits and clears', async () => {
  await go('2', 'Fleet ·');
  await harness.ui.press('/');
  await harness.ui.type('review');
  const filtered = await harness.ui.waitFor('filter “review”');
  assert.match(filtered, /\d+ of \d+/);
  await harness.ui.press('RETURN');
  await harness.ui.press('/');
  await harness.ui.type('zzzzzz');
  await harness.ui.waitFor('No session matches');
  await harness.ui.press('BACKSPACE');
  await harness.ui.press('ESCAPE');
  await harness.ui.waitFor('filter “review”');
  await harness.ui.press('ESCAPE');
  await harness.ui.waitFor(frame => !frame.includes('filter “review”'));
});

test('requests filter is live, counts matches and distinguishes no match', async () => {
  await go('3', 'Requests');
  await harness.ui.press('/');
  await harness.ui.type('zzzzzzzzzz');
  const empty = await harness.ui.waitFor('No request matches');
  assert.match(empty, /0 of \d+/);
  await harness.ui.press('BACKSPACE');
  await harness.ui.press('ESCAPE');
  await harness.ui.waitFor(frame => !frame.includes('No request matches'));
  await harness.ui.press('/');
  await harness.ui.type('Check');
  await harness.ui.waitFor('text “Check”');
  await harness.ui.press('RETURN');
  await harness.ui.press('ESCAPE');
});

test('help lists the shared keymap and settings shows connection health', async () => {
  await harness.ui.press('?');
  const help = await harness.ui.waitFor('KEYBOARD MAP');
  assert.match(help, /Command palette/);
  await harness.ui.press('ESCAPE');
  await harness.ui.press(',');
  const settings = await harness.ui.waitFor('Settings');
  assert.match(settings, /Stream\s+connected/);
  await harness.ui.press('ESCAPE');
});

test('timeline keys zoom and pan without throwing', async () => {
  await go('6', 'Timeline');
  for (const key of ['+', '-', 'h', 'l', 't', 't']) await harness.ui.press(key);
  assert.match(harness.ui.frame(), /Timeline/);
  await harness.ui.press('1');
});

test('messages toggle to the graph and back', async () => {
  await go('5', 'Messages');
  await harness.ui.press('v');
  await harness.ui.waitFor('Communication graph');
  await harness.ui.press('v');
  await harness.ui.press('1');
});

test('terminal escapes in transcript text never reach the screen as control characters', async () => {
  await go('2', 'Fleet ·');
  await harness.ui.press('j');
  await harness.ui.press('j');
  await harness.ui.press('RETURN');
  await harness.ui.waitFor('Transcript');
  await new Promise(resolveWait => setTimeout(resolveWait, 300));
  await harness.ui.settle();
  const controls = [...harness.ui.frame()].filter(character => { const code = character.codePointAt(0) ?? 0; return (code < 32 && code !== 10) || (code >= 127 && code <= 159); });
  assert.deepEqual(controls, []);
  await harness.ui.press('ESCAPE');
});

test('quit key requests exit and never touches sessions', async () => {
  await harness.ui.press('q');
  assert.equal(harness.quit.requested, true);
});

test('resizing re-lays out and a narrow terminal drops the side panels', async () => {
  await harness.ui.resize(80, 24);
  const narrow = harness.ui.frame();
  assert.match(narrow, /π/);
  assert.doesNotMatch(narrow, /Selected/);
  await harness.ui.resize(140, 42);
});

test('daemon going away shows the reconnect banner', async () => {
  await harness.daemon.close();
  for (let attempt = 0; attempt < 100 && harness.runtime.store.getSnapshot().connection.connected; attempt++) await new Promise(resolveWait => setTimeout(resolveWait, 50));
  await new Promise(resolveWait => setTimeout(resolveWait, 100));
  await harness.ui.settle();
  await harness.ui.waitFor('retrying');
  assert.match(harness.ui.frame(), /offline/);
});
