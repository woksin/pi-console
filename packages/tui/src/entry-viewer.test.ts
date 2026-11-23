import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot, TranscriptEntry } from '@pi-console/contract';
import { App } from './app.ts';
import { Store } from './store/store.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const id = fixture.sessions[0].id;
const numbered = (count: number, mark = -1, word = 'NEEDLE'): string => Array.from({ length: count }, (_, index) => `row ${String(index)} ${index === mark ? word : 'plain'}`).join('\n');

type Extra = Pick<Partial<TranscriptEntry>, 'toolCallId' | 'toolResult'>;
function entry(cursor: number, kind: TranscriptEntry['kind'], text: string, extra: Extra = {}): TranscriptEntry {
  return { id: `e${String(cursor)}`, cursor, sessionId: id, at: fixture.generatedAt, kind, text, toolCallId: null, resetId: null, requestId: null, toolResult: null, ...extra };
}

async function mount(entries: TranscriptEntry[]) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: fixture });
  store.mergeTranscript(id, entries);
  store.setConnection(true, '');
  store.flush();
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id }, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), { width: 120, height: 40 });
  await ui.settle();
  return { ui, store, done: () => { ui.destroy(); store.dispose(); } };
}

test('the compact preview names how many lines it cut, and Enter opens the whole entry', async () => {
  const { ui, done } = await mount([entry(1, 'assistant', numbered(30))]);
  try {
    assert.match(ui.frame(), /… 16 more lines · ⏎ opens the full entry/);
    assert.doesNotMatch(ui.frame(), /row 29 plain/);
    await ui.press('RETURN');
    assert.match(ui.frame(), /row 29 plain/);
    assert.match(ui.frame(), /row 0 plain/);
  } finally { done(); }
});

test('a search match beyond line 14 opens scrolled to the match and highlighted', async () => {
  const { ui, done } = await mount([entry(1, 'assistant', numbered(60, 40))]);
  try {
    await ui.press('/');
    await ui.type('needle');
    await ui.press('RETURN');
    assert.doesNotMatch(ui.frame(), /row 40 NEEDLE/);
    await ui.press('RETURN');
    const frame = ui.frame();
    assert.match(frame, /row 40 NEEDLE/);
    assert.doesNotMatch(frame, /row 0 plain/);
    assert.match(frame, /First match of “needle” highlighted/);
  } finally { done(); }
});

test('a long tool result shows every line in the viewer', async () => {
  const text = numbered(30);
  const { ui, done } = await mount([entry(1, 'tool.result', text, { toolCallId: 'c1', toolResult: { toolName: 'read', argsExcerpt: 'src/a.ts', resultKind: 'text', resultExcerpt: text, truncated: false, withheld: false } })]);
  try {
    assert.doesNotMatch(ui.frame(), /row 29 plain/);
    await ui.press('RETURN');
    assert.match(ui.frame(), /row 0 plain/);
    await ui.press('END');
    assert.match(ui.frame(), /row 29 plain/);
  } finally { done(); }
});

test('a wide multi-line diff is wrapped in the viewer, with no line clipped', async () => {
  const wide = `+${'a'.repeat(150)}TAILMARK`;
  const { ui, done } = await mount([entry(1, 'diff', `@@ -1 +1 @@\n${wide}\n-${'b'.repeat(150)}OLDTAIL`)]);
  try {
    assert.doesNotMatch(ui.frame(), /TAILMARK/);
    assert.match(ui.frame(), /clipped · ⏎ opens the full entry/);
    await ui.press('RETURN');
    assert.match(ui.frame(), /TAILMARK/);
    assert.match(ui.frame(), /OLDTAIL/);
  } finally { done(); }
});

test('closing the viewer restores the paused anchor, and follow state', async () => {
  const many = Array.from({ length: 40 }, (_, index) => entry(index + 1, 'assistant', `entry ${String(index)}\n${numbered(20)}`));
  const { ui, done } = await mount(many);
  try {
    for (let step = 0; step < 30; step++) await ui.press('k');
    const paused = ui.frame();
    assert.match(paused, /paused.*f to follow/);
    await ui.press('RETURN');
    assert.notEqual(ui.frame(), paused);
    await ui.press('ESCAPE');
    assert.equal(ui.frame(), paused);
    await ui.press('f');
    assert.match(ui.frame(), /following tail/);
    await ui.press('RETURN');
    await ui.press('ESCAPE');
    assert.match(ui.frame(), /following tail/);
  } finally { done(); }
});
