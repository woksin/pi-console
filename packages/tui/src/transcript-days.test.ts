import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot, TranscriptEntry } from '@pi-console/contract';
import { App } from './app.ts';
import { Store } from './store/store.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const id = fixture.sessions[0].id;
const entry = (cursor: number, at: string, text: string): TranscriptEntry => ({ id: `e${String(cursor)}`, cursor, sessionId: id, at, kind: 'assistant', text, toolCallId: null, resetId: null, requestId: null, toolResult: null });
const count = (text: string, part: string): number => text.split(part).length - 1;

async function mount(entries: TranscriptEntry[], width = 120, height = 40) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: fixture });
  store.mergeTranscript(id, entries);
  store.setConnection(true, '');
  store.flush();
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id }, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), { width, height });
  await ui.settle();
  return { ui, store, done: () => { ui.destroy(); store.dispose(); } };
}

const acrossMidnight = [
  entry(1, '2026-11-19T23:59:50Z', 'before midnight'), entry(2, '2026-11-20T00:00:10Z', 'after midnight'), entry(3, '2026-11-20T00:05:00Z', 'same day again'),
];

for (const width of [80, 112]) test(`one date rule opens each displayed day at ${String(width)} columns, and the panel names the first visible day`, async () => {
  const { ui, done } = await mount(acrossMidnight, width);
  try {
    const frame = ui.frame();
    assert.equal(count(frame, '19 Nov 2026'), 2, 'rule plus panel title');
    assert.equal(count(frame, '20 Nov 2026'), 1, 'one rule for both entries of the day');
    assert.match(frame, /Transcript · 19 Nov 2026/);
    assert.ok(frame.indexOf('before midnight') < frame.indexOf('20 Nov 2026') && frame.indexOf('20 Nov 2026') < frame.indexOf('after midnight'));
  } finally { done(); }
});

test('Enter opens the real entry at the top even with a date rule above it, and the viewer shows the full time and zone', async () => {
  const { ui, done } = await mount(acrossMidnight, 80);
  try {
    await ui.press('RETURN');
    const frame = ui.frame();
    assert.match(frame, /19 Nov 2026 23:59:50 UTC/);
    assert.match(frame, /before midnight/);
  } finally { done(); }
});

test('the viewer keeps the time visible while a search match scrolls the document', async () => {
  const long = Array.from({ length: 60 }, (_, index) => `row ${String(index)} ${index === 40 ? 'NEEDLE' : 'plain'}`).join('\n');
  const { ui, done } = await mount([entry(1, '2026-11-19T23:59:50Z', long)], 80);
  try {
    await ui.press('/'); await ui.type('needle'); await ui.press('RETURN'); await ui.press('RETURN');
    const frame = ui.frame();
    assert.match(frame, /row 40 NEEDLE/);
    assert.match(frame, /19 Nov 2026 23:59:50 UTC/);
    assert.doesNotMatch(frame, /row 0 plain/);
  } finally { done(); }
});

test('merging an older page from the previous day adds that day\'s rule at the top and keeps one rule per day', async () => {
  const { ui, store, done } = await mount([entry(5, '2026-11-20T08:00:00Z', 'today one'), entry(6, '2026-11-20T08:05:00Z', 'today two')]);
  try {
    assert.equal(count(ui.frame(), '20 Nov 2026'), 2, 'rule plus panel title');
    store.mergeTranscript(id, [entry(1, '2026-11-19T22:00:00Z', 'yesterday one'), entry(2, '2026-11-19T22:05:00Z', 'yesterday two')]);
    store.flush(); await ui.settle();
    const frame = ui.frame();
    assert.equal(count(frame, '19 Nov 2026'), 2, 'rule plus panel title');
    assert.equal(count(frame, '20 Nov 2026'), 1);
    assert.match(frame, /Transcript · 19 Nov 2026/);
  } finally { done(); }
});
