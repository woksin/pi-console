import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keymapGroups, wrap } from '@pi-console/viewmodels';
import { Help } from './overlays.ts';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';

const safety = 'Ordinary access is read-only. Opt-in memory review only requests a review; a human must confirm it in pi. The console never writes memory directly.';
const squash = (frame: string): string => frame.replace(/[│\s]+/g, ' ');

test('two-column help at 120×40 displays every binding, group and the review safety text', async () => {
  const ui = await mountHeadless(h(Screen, {}, h(Help, { width: 120, height: 40 })), { width: 120, height: 40 });
  try {
    const frame = await ui.waitFor('KEYBOARD MAP (SHARED WITH THE WEB CONSOLE)');
    for (const group of keymapGroups('tui')) {
      assert.match(frame, new RegExp(group.title.toUpperCase()));
      for (const binding of group.bindings) {
        for (const line of wrap(binding.label, 40)) assert.ok(frame.includes(line), line);
      }
    }
    assert.ok(squash(frame).includes(safety));
    assert.doesNotMatch(frame, /nothing here can change a session/);
    assert.match(frame, /↑/);
    assert.match(frame, /↓/);
    assert.doesNotMatch(frame, /ArrowDown|ArrowUp|ArrowLeft|ArrowRight/);
    assert.match(frame, /\? or esc closes/);
  } finally { ui.destroy(); }
});

for (const [width, height] of [[80, 24], [100, 12], [160, 40]]) {
  test(`help at ${String(width)}×${String(height)} explains the read-only default and the request-only review exception, and lists the Memory view key`, async () => {
    const store = new Store();
    const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), { width, height });
    try {
      await ui.settle();
      await ui.press('?');
      let seen = ui.frame();
      assert.ok(squash(seen).includes('Ordinary access is read-only.'));
      for (let line = 0; line < 120; line++) { await ui.press('j'); seen += ui.frame(); }
      const text = squash(seen);
      assert.ok(text.includes('Open the full Memory view'));
      assert.ok(text.includes('The console never writes memory directly.'));
      assert.doesNotMatch(text, /nothing here can change a session/);
    } finally { ui.destroy(); store.dispose(); }
  });
}
