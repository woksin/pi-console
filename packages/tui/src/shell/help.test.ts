import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keymapGroups } from '@pi-console/viewmodels';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { h, mountHeadless } from '../view/renderer.ts';

test('80x24: Help scrolls through every shared binding and shows its position without moving the underlying list', async () => {
  const store = new Store();
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), { width: 80, height: 24 });
  try {
    await ui.settle();
    await ui.press('?');
    assert.match(ui.frame(), /1–\d+ of \d+/);
    const first = ui.frame();
    await ui.press('ARROW_DOWN');
    assert.notEqual(ui.frame(), first);
    await ui.press('ARROW_UP');
    assert.equal(ui.frame(), first);
    await ui.press('\u001b[6~');
    assert.notEqual(ui.frame(), first);
    await ui.press('\u001b[5~');
    assert.equal(ui.frame(), first);
    let seen = first;
    for (let line = 0; line < 160; line++) { await ui.press('j'); seen += ui.frame(); }
    const text = seen.replace(/[│\s]+/g, ' ');
    for (const group of keymapGroups('tui')) {
      assert.ok(text.includes(group.title.toUpperCase()), group.title);
      for (const binding of group.bindings) assert.ok(text.includes(binding.label), binding.label);
    }
    await ui.press('HOME');
    assert.equal(ui.frame(), first);
    await ui.press('END');
    const last = ui.frame();
    await ui.press('ARROW_DOWN');
    assert.equal(ui.frame(), last, 'clamped at the end');
    await ui.press('ESCAPE');
    assert.doesNotMatch(ui.frame(), /Keyboard map/);
    await ui.press('?');
    assert.equal(ui.frame(), first, 'reopening resets scroll');
    await ui.press('?');
    assert.doesNotMatch(ui.frame(), /Keyboard map/);
  } finally { ui.destroy(); store.dispose(); }
});
