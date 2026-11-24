import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot, TranscriptEntry } from '@pi-console/contract';
import { App } from './app.ts';
import { Store } from './store/store.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const id = fixture.sessions[0].id;
const entries: TranscriptEntry[] = Array.from({ length: 6 }, (_, index) => ({
  id: `entry-${String(index)}`, cursor: index + 1, sessionId: id, at: `2026-11-20T09:0${String(index)}:00Z`, kind: 'assistant',
  text: Array.from({ length: 4 }, (_, row) => `ENTRY${String(index)} ${row === 0 ? 'start' : 'continuation'}`).join('\n'),
  toolCallId: null, resetId: null, requestId: null, toolResult: null,
}));

for (const width of [80, 120]) {
  test(`the initial transcript, pause and entry selection agree on an entry start at ${String(width)} columns`, async () => {
    const store = new Store();
    store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: fixture });
    store.mergeTranscript(id, entries);
    store.setConnection(true, '');
    store.flush();
    const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id }, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), { width, height: 24 });
    try {
      await ui.settle();
      const first = ui.frame().split('\n').find(line => line.includes('ENTRY'));
      assert.ok(first);
      assert.match(first, /09:0\d:00 ● ENTRY\d start/);
      assert.match(ui.frame(), /ENTRY5 start/);
      const marker = /ENTRY\d/.exec(first)?.[0];
      assert.ok(marker);
      await ui.press('f');
      assert.equal(ui.frame().split('\n').find(line => line.includes('ENTRY')), first);
      await ui.press('RETURN');
      assert.ok(ui.frame().includes(`${marker} start`));
      assert.match(ui.frame(), /20 Nov 2026 09:0\d:00 UTC/);
    } finally { ui.destroy(); store.dispose(); }
  });
}
