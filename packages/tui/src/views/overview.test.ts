import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlashTracker, LookTracker, pressureHistogram } from '@pi-console/viewmodels';
import { generate, needsYou } from '@pi-console/testkit';
import type { Session } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { overviewView, pressureLines } from './overview.ts';

const text = (line: readonly { text: string }[]): string => line.map(part => part.text).join('');

test('the pressure histogram draws bars on the shared ramp with the 60 and 80 % ticks on bin edges and counts in words', () => {
  const histogram = pressureHistogram([5, 5, 5, 65, 85, 85, 100].map(contextPercent => ({ contextPercent })));
  const lines = pressureLines(histogram);
  assert.equal(lines.length, 6);
  for (const line of lines.slice(0, 4)) assert.equal(Array.from(text(line)).length, 30);
  assert.equal(text(lines[0]).slice(0, 2), '██', 'the tallest bin reaches the top row');
  assert.deepEqual([Array.from(text(lines[1]))[18], Array.from(text(lines[2]))[18]], [' ', '█'], 'a third of the peak fills the bottom row only');
  for (const line of lines.slice(0, 3)) assert.deepEqual([Array.from(text(line))[17], Array.from(text(line))[23]], ['┊', '┊']);
  assert.deepEqual([Array.from(text(lines[3]))[17], Array.from(text(lines[3]))[23]], ['┼', '┼']);
  assert.equal(text(lines[4]).indexOf('60'), 16);
  assert.equal(text(lines[4]).indexOf('80'), 22);
  assert.equal(lines[0][0].color, 'pressure:0');
  assert.equal(lines[0].at(-2)?.color, 'pressure:100');
  assert.match(text(lines[5]), /^3 above 80 % {2}1 at 60–80 %$/);
});

test('new attention items get a divider and a tag until the Overview is left', async () => {
  const fixture = generate().fixture;
  const items = needsYou(fixture).items;
  const changes = { look: new LookTracker(), flash: new FlashTracker(), motion: false };
  const frame = async (list: typeof items): Promise<string> => {
    const data = { ...new Store().getSnapshot(), loaded: true, sessions: (fixture as unknown as { sessions: Session[] }).sessions, needsYou: list };
    const view = overviewView({ data, ui: initial, width: 100, height: 30, now: 0, phase: 0, click: () => undefined, changes });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 30 });
    try { await ui.settle(); return ui.frame(); } finally { ui.destroy(); }
  };
  assert.doesNotMatch(await frame(items.slice(1)), /new since you looked/, 'the first look is the baseline');
  const fresh = await frame(items);
  assert.match(fresh, /── 1 new since you looked ─+/);
  assert.equal(fresh.match(/ new\b(?! since)/g)?.length, 1, 'exactly the one new card is tagged');
  changes.look.leave();
  assert.doesNotMatch(await frame(items), /new since you looked/);
});
