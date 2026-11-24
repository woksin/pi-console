import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlashTracker, LookTracker, pressureHistogram } from '@pi-console/viewmodels';
import { generate, needsYou } from '@pi-console/testkit';
import type { Event, Session } from '@pi-console/contract';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { fleetTotals, overviewView, pressureLines } from './overview.ts';

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

test('first run shows the checklist without empty fleet status bars or histogram', async () => {
  const data = { ...new Store().getSnapshot(), loaded: true, needsYouLoaded: true };
  const view = overviewView({ data, ui: initial, width: 160, height: 40, now: 0, phase: 0, click: () => undefined });
  const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 160, height: 40 });
  try {
    await ui.settle();
    assert.match(ui.frame(), /Sources detected/);
    assert.doesNotMatch(ui.frame(), /Status|Context pressure|Context, fleet average|working right now/);
  } finally { ui.destroy(); }
});

test('attention loading and failure stay separate from connection; retry reaches empty-after-load', async () => {
  const store = new Store();
  const fixture = generate().fixture;
  store.apply({ type: 'snapshot', seq: 1, payload: fixture } as unknown as Event);
  store.setConnection(true, '');
  let retries = 0;
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://127.0.0.1', tokenSource: 'test', animate: false,
    loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined,
    retryNeedsYou: () => { retries++; store.setNeedsYouError(false); },
  }), { width: 110, height: 30 });
  const settleStore = async () => { await new Promise(resolve => setTimeout(resolve, 60)); await ui.settle(); };
  try {
    await ui.settle();
    assert.match(ui.frame(), /Loading…/);
    assert.match(ui.frame(), /checking…/);
    assert.doesNotMatch(ui.frame(), /[Aa]ll clear|Sources detected/);
    store.setNeedsYouError(true);
    await settleStore();
    assert.match(ui.frame(), /Could not load needs you\./);
    assert.match(ui.frame(), /unavailable/);
    assert.match(ui.frame(), /r retry/);
    assert.doesNotMatch(ui.frame(), /[Aa]ll clear|Sources detected|Disconnected/);
    await ui.press('r');
    assert.equal(retries, 1);
    await settleStore();
    assert.match(ui.frame(), /Loading…/);
    store.setNeedsYou([]);
    await settleStore();
    assert.match(ui.frame(), /All clear/);
    assert.match(ui.frame(), /Nothing needs you\./);
    await ui.press('r');
    assert.equal(retries, 1, 'healthy lists do not retry');
    store.setNeedsYouError(true);
    await settleStore();
    assert.match(ui.frame(), /All clear: nothing needs you · stale/);
    assert.match(ui.frame(), /0 stale/);
    assert.match(ui.frame(), /r retry/);
    assert.doesNotMatch(ui.frame(), /Nothing needs you\./, 'a later failure does not present cached calm as current');
    await ui.press('r');
    assert.equal(retries, 2);
    await settleStore();
    assert.match(ui.frame(), /0 stale/);
    assert.match(ui.frame(), /Loading…/);
    store.setNeedsYou(needsYou(fixture).items);
    await settleStore();
    assert.doesNotMatch(ui.frame(), /things need you · stale|unavailable|[Aa]ll clear/);
  } finally { ui.destroy(); store.dispose(); }
});

test('Overview marks non-empty cached attention stale after a failed refresh', async () => {
  const store = new Store();
  const fixture = generate().fixture;
  const items = needsYou(fixture).items;
  store.apply({ type: 'snapshot', seq: 1, payload: fixture } as unknown as Event);
  store.setNeedsYou(items);
  store.setNeedsYouError(true);
  const view = overviewView({ data: store.getSnapshot(), ui: initial, width: 100, height: 30, now: 0, phase: 0, click: () => undefined });
  const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 30 });
  try {
    await ui.settle();
    assert.match(ui.frame(), new RegExp(`${String(items.length)} things need you · stale`));
    assert.match(ui.frame(), /r retry/);
    assert.doesNotMatch(ui.frame(), /All clear|Could not load needs you\./);
  } finally { ui.destroy(); store.dispose(); }
});

test('new attention items get a divider and a tag until the Overview is left', async () => {
  const fixture = generate().fixture;
  const items = needsYou(fixture).items;
  const visible = items.find(item => item.reason === 'blocking-question');
  assert.ok(visible, 'a high-priority card is visible after grouping');
  const changes = { look: new LookTracker(), flash: new FlashTracker(), motion: false };
  const frame = async (list: typeof items, needsYouLoaded = true): Promise<string> => {
    const data = { ...new Store().getSnapshot(), loaded: true, sessions: (fixture as unknown as { sessions: Session[] }).sessions, needsYou: list, needsYouLoaded };
    const view = overviewView({ data, ui: initial, width: 100, height: 30, now: 0, phase: 0, click: () => undefined, changes });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 30 });
    try { await ui.settle(); return ui.frame(); } finally { ui.destroy(); }
  };
  await frame([], false);
  assert.doesNotMatch(await frame(items.filter(item => item.id !== visible.id)), /new since you looked/, 'the first look after the attention list arrives is the baseline');
  const fresh = await frame(items);
  assert.match(fresh, /── 1 new since you looked ─+/);
  assert.equal(fresh.match(/ new\b(?! since)/g)?.length, 1, 'exactly the one new card is tagged');
  changes.look.leave();
  assert.doesNotMatch(await frame(items), /new since you looked/);
});

test('fleet totals wrap the known-cost qualifier at a word boundary inside the panel width', () => {
  const lines = fleetTotals({ fleet: { tokens: '2.7M', cost: '$82.85 (known; 14/16 sessions)' } } as never, 33).map(text);
  assert.deepEqual(lines, ['tokens 2.7M', 'cost $82.85 (known; 14/16', 'sessions)']);
  assert.ok(lines.every(line => Array.from(line).length <= 33));
});
