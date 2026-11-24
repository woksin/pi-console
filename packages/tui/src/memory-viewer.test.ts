import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { MemoryItem, SessionMemory, Snapshot, TranscriptEntry } from '@pi-console/contract';
import { emptyMemoryReview } from '@pi-console/viewmodels';
import { App } from './app.ts';
import { Store, type MemoryHistory } from './store/store.ts';
import type { UiState } from './state/ui.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const id = fixture.sessions[0].id;
const words = Array.from({ length: 120 }, (_, index) => `w${String(index).padStart(3, '0')}`).join(' ');
const longText = `FIRSTMARK ${words} ${'x'.repeat(200)}TOKENTAIL ${'界'.repeat(90)}CJKEND LASTMARK`;
const base: MemoryItem = {
  id: 'item-a', kind: 'order', scope: { kind: 'session', key: id }, sessionId: id, status: 'proposed', statusBasis: 'recorded', text: longText, withheld: false,
  sourceType: 'coordinator_order', sourceMessageId: null, at: fixture.generatedAt, command: '/memory confirm item-a',
};
const items: MemoryItem[] = [base, { ...base, id: 'item-b', text: 'SHORTITEM', status: 'done', command: null }, { ...base, id: 'item-c', text: 'THIRDITEM' }];
const summary: SessionMemory = {
  sessionId: id, storeDetected: true, counts: { active: 0, proposed: 2, done: 1, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 2,
  unresolved: { lowerBound: 2, atLastHandoff: null }, wider: 0, handoffs: [],
};
const review = { ...emptyMemoryReview(), availability: { version: 1 as const, available: true, providerVersion: 1, generation: 'g1', reason: 'available' as const } };

function entry(cursor: number, text: string): TranscriptEntry {
  return { id: `e${String(cursor)}`, cursor, sessionId: id, at: fixture.generatedAt, kind: 'assistant', text, toolCallId: null, resetId: null, requestId: null, toolResult: null };
}

interface Options { width: number; height?: number; initialState?: Partial<UiState>; history?: MemoryHistory; entries?: TranscriptEntry[]; sessionName?: string }

async function mount({ width, height = 20, initialState = {}, history, entries = [], sessionName = fixture.sessions[0].name }: Options) {
  const store = new Store();
  const sessions = fixture.sessions.map(session => session.id === id ? { ...session, name: sessionName } : session);
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: { ...fixture, sessions } });
  store.mergeTranscript(id, entries);
  store.mergeMemory(id, summary, items);
  store.setMemoryReview(id, review);
  if (history) store.setMemoryHistory(id, history);
  store.setConnection(true, '');
  store.flush();
  const calls = { requests: [] as unknown[][], loads: [] as string[], pages: 0 };
  const props = {
    store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id, ...initialState }, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined,
    requestMemoryAction: (...args: unknown[]) => { calls.requests.push(args); }, loadMoreMemory: (session: string) => { calls.loads.push(session); },
    pageTranscript: () => { calls.pages++; },
  };
  const ui = await mountHeadless(h(App, props as never), { width, height });
  await ui.settle();
  return { ui, store, calls, done: () => { ui.destroy(); store.dispose(); } };
}

for (const width of [80, 100, 160]) {
  test(`m opens the full Memory view at ${String(width)} columns and every line of the item can be reached`, async () => {
    const { ui, done } = await mount({ width });
    try {
      assert.doesNotMatch(ui.frame(), /FIRSTMARK/);
      await ui.press('m');
      let seen = ui.frame();
      assert.match(seen, /Memory/);
      assert.match(seen, /FIRSTMARK/);
      assert.match(seen, /Item 1 of 3 · \[\/\] prev\/next/);
      assert.match(seen, /1–\d+ of \d+/);
      assert.doesNotMatch(seen, /LASTMARK/);
      assert.ok(seen.split('\n').some(line => line.length >= width - 6 && /w\d{3} w\d{3}/.test(line)), 'text uses the full width');
      for (let step = 0; step < 80; step++) { await ui.press('PAGEDOWN'); seen += ui.frame(); }
      await ui.press('END');
      const last = ui.frame();
      assert.match(last, /LASTMARK/);
      const flat = (seen + last).replace(/[│\s]+/g, '');
      for (const marker of ['w119', 'TOKENTAIL', 'CJKEND']) assert.ok(flat.includes(marker), marker);
      assert.match(last, /Run in a pi session|c\/x request review in pi/);
      await ui.press('HOME');
      assert.match(ui.frame(), /FIRSTMARK/);
    } finally { done(); }
  });
}

for (const width of [60, 80, 100]) {
  test(`PageDown covers every word with a long session label at ${String(width)} columns`, async () => {
    const { ui, done } = await mount({ width, sessionName: 'aurora scout coordinating implementation and verification across several repositories'.repeat(3) });
    try {
      await ui.press('m');
      const seen = new Set<string>();
      let previousEnd = 0;
      for (let page = 0; page < 80; page++) {
        const frame = ui.frame();
        const range = /(\d+)–(\d+) of (\d+)/.exec(frame);
        assert.ok(range, 'the visible row range is shown');
        assert.ok(Number(range[1]) <= previousEnd + 1, 'PageDown never skips a row');
        previousEnd = Number(range[2]);
        for (const word of frame.match(/\bw\d{3}\b/g) ?? []) seen.add(word);
        if (previousEnd === Number(range[3])) break;
        await ui.press('\u001b[6~');
      }
      for (const word of words.split(' ')) assert.ok(seen.has(word), `missing ${word}`);
    } finally { done(); }
  });
}

test('arrows, j/k, PgUp/PgDn and g/G scroll the Memory view and never the transcript', async () => {
  const many = Array.from({ length: 40 }, (_, index) => entry(index + 1, `entry ${String(index)}`));
  const { ui, calls, done } = await mount({ width: 100, entries: many, initialState: { pane: 'jobs' } });
  try {
    await ui.press('m');
    const top = ui.frame();
    for (const key of ['j', 'ARROW_DOWN', '\u001b[6~']) { await ui.press(key); assert.notEqual(ui.frame(), top, key); await ui.press('HOME'); assert.equal(ui.frame(), top); }
    await ui.press('G');
    const bottom = ui.frame();
    for (const key of ['k', 'ARROW_UP', '\u001b[5~']) { await ui.press(key); assert.notEqual(ui.frame(), bottom, key); await ui.press('END'); assert.equal(ui.frame(), bottom); }
    await ui.press('g');
    assert.equal(ui.frame(), top);
    assert.equal(calls.pages, 0, 'no transcript paging while Memory is open');
  } finally { done(); }
});

test('brackets change the selected item and reset only the Memory scroll; the older page loads at the edge', async () => {
  const { ui, calls, done } = await mount({ width: 80, history: { cursor: 'c', more: true, total: 9, loading: false } });
  try {
    await ui.press('m');
    await ui.press('END');
    assert.match(ui.frame(), /LASTMARK/);
    await ui.press(']');
    const second = ui.frame();
    assert.match(second, /Item 2 of 3/);
    assert.match(second, /SHORTITEM/);
    assert.deepEqual(calls.loads, []);
    await ui.press(']');
    assert.match(ui.frame(), /THIRDITEM/);
    assert.deepEqual(calls.loads, [id], 'the loaded edge asks for older memory');
    await ui.press(']');
    assert.match(ui.frame(), /Item 3 of 3/);
    await ui.press('[');
    await ui.press('[');
    assert.match(ui.frame(), /FIRSTMARK/, 'a new selection starts at the top');
  } finally { done(); }
});

test('c and x request a review of only the selected requestable item; nothing else changes', async () => {
  const { ui, store, calls, done } = await mount({ width: 80 });
  try {
    await ui.press('m');
    await ui.press('c');
    await ui.press('x');
    await ui.press(']');
    await ui.press('c');
    await ui.press(']');
    await ui.press('x');
    assert.deepEqual(calls.requests, [[id, 'item-a', 'confirm'], [id, 'item-a', 'reject'], [id, 'item-c', 'reject']], 'the completed item is skipped');
    assert.equal(store.getSnapshot().memoryItems.get(id)?.[0].status, 'proposed', 'no optimistic status change');
  } finally { done(); }
});

test('r retries a failed memory load from the Memory view, once per press', async () => {
  const { ui, calls, done } = await mount({ width: 80, history: { cursor: 'c', more: true, loading: false, error: 'more' } });
  try {
    await ui.press('m');
    assert.match(ui.frame(), /Could not load more memory items/);
    await ui.press('r');
    assert.deepEqual(calls.loads, [id]);
  } finally { done(); }
});

test('memory keys do nothing on a hidden rail, in another overlay or without a session', async () => {
  const hidden = await mount({ width: 100, initialState: { pane: 'memory' } });
  try {
    for (const key of ['c', 'x', ']', 'r']) await hidden.ui.press(key);
    assert.deepEqual(hidden.calls.requests, []);
    assert.deepEqual(hidden.calls.loads, []);
    await hidden.ui.press('?');
    await hidden.ui.press('c');
    await hidden.ui.press('m');
    assert.match(hidden.ui.frame(), /KEYBOARD MAP/);
    assert.doesNotMatch(hidden.ui.frame(), /FIRSTMARK/);
    assert.deepEqual(hidden.calls.requests, []);
  } finally { hidden.done(); }
  const none = await mount({ width: 100, initialState: { sessionId: null } });
  try {
    await none.ui.press('m');
    await none.ui.press('c');
    assert.doesNotMatch(none.ui.frame(), /FIRSTMARK/);
    assert.deepEqual(none.calls.requests, []);
  } finally { none.done(); }
});

test('the wide rail keeps its selection keys and points at the full view', async () => {
  const { ui, calls, done } = await mount({ width: 160, initialState: { pane: 'memory' } });
  try {
    assert.match(ui.frame(), /m full view/);
    await ui.press('c');
    assert.deepEqual(calls.requests, [[id, 'item-a', 'confirm']]);
    await ui.press('m');
    assert.match(ui.frame(), /LASTMARK|FIRSTMARK/);
  } finally { done(); }
});

test('Esc returns to the same paused transcript, and a following transcript keeps following', async () => {
  const many = Array.from({ length: 40 }, (_, index) => entry(index + 1, `entry ${String(index)}\nrow a\nrow b\nrow c\nrow d`));
  const { ui, store, done } = await mount({ width: 100, entries: many });
  try {
    for (let step = 0; step < 30; step++) await ui.press('k');
    const paused = ui.frame();
    assert.match(paused, /paused.*f to follow/);
    await ui.press('m');
    await ui.press('END');
    store.mergeTranscript(id, [...many, entry(41, 'appended while open')]);
    store.flush();
    await ui.settle();
    await ui.press('ESCAPE');
    const sameRows = (frame: string): string => frame.replace(/\d+ lines above/, 'N lines above');
    assert.equal(sameRows(ui.frame()), sameRows(paused), 'the paused anchor stays fixed while new entries arrive');
    await ui.press('f');
    assert.match(ui.frame(), /following tail/);
    await ui.press('m');
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /following tail/);
  } finally { done(); }
});

test('the Memory view shrinks and closes cleanly with no memory and after a resize', async () => {
  const { ui, store, done } = await mount({ width: 160 });
  try {
    await ui.press('m');
    await ui.press('END');
    await ui.resize(80, 40);
    assert.match(ui.frame(), /Memory/);
    await ui.press('ESCAPE');
    store.mergeMemory(id, { ...summary, storeDetected: false }, []);
    store.flush();
    await ui.press('m');
    assert.match(ui.frame(), /No intent-memory store seen/);
    await ui.press('j');
    await ui.press(']');
    await ui.press('ESCAPE');
    assert.doesNotMatch(ui.frame(), /No intent-memory store seen/);
  } finally { done(); }
});
