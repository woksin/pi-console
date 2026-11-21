import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keymapGroups, wrap } from '@pi-console/viewmodels';
import { Help } from './overlays.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';

test('two-column help at 120×40 displays every binding, group and the read-only footer', async () => {
  const ui = await mountHeadless(h(Screen, {}, h(Help, { width: 120, height: 40 })), { width: 120, height: 40 });
  try {
    const frame = await ui.waitFor('Keyboard map');
    for (const group of keymapGroups('tui')) {
      assert.match(frame, new RegExp(group.title.toUpperCase()));
      for (const binding of group.bindings) {
        for (const line of wrap(binding.label, 40)) assert.ok(frame.includes(line), line);
      }
    }
    assert.match(frame, /Read-only: nothing here can change a session/);
    assert.match(frame, /↑/);
    assert.match(frame, /↓/);
    assert.doesNotMatch(frame, /ArrowDown|ArrowUp|ArrowLeft|ArrowRight/);
    assert.match(frame, /\? or esc closes/);
  } finally { ui.destroy(); }
});
