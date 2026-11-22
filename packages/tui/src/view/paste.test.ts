import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import { Screen, h, mountHeadless, useKeys } from './renderer.ts';

async function setup(initialState: Partial<UiState> = {}) {
  const store = new Store();
  const quit = { requested: false };
  const ui = await mountHeadless(h(App, {
    store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState,
    loadTranscript: () => undefined, loadMemory: () => undefined,
    onQuit: () => { quit.requested = true; },
  }), { width: 140, height: 30 });
  await ui.settle();
  return { ui, quit, destroy: () => { ui.destroy(); store.dispose(); } };
}

for (const overlay of ['filter', 'search', 'palette'] as const) {
  test(`bracketed paste appends to the focused ${overlay} without submitting or cancelling it`, async () => {
    const { ui, quit, destroy } = await setup({ overlay, input: 'seed ' });
    try {
      await ui.paste('café ✓\r\n\nquery\rtail\u001b[31m!\u001b[0m\u0003');
      assert.match(ui.frame(), /seed café ✓ query tail!/);
      assert.equal(quit.requested, false);
      await ui.press('BACKSPACE');
      await ui.type('?');
      assert.match(ui.frame(), /seed café ✓ query tail\?/);
      await ui.press('ESCAPE');
      assert.doesNotMatch(ui.frame(), /seed café/);
    } finally { destroy(); }
  });
}

test('paste strips terminal sequences and controls, folds line breaks and preserves printable Unicode', async () => {
  const pasted: string[] = [];
  function Probe() {
    useKeys(() => undefined, text => { pasted.push(text); });
    return h(Screen, {});
  }
  const ui = await mountHeadless(h(Probe), { width: 80, height: 24 });
  try {
    await ui.settle();
    await ui.paste('a\u001b[31mred\u001b[0m\u001b]0;hidden\u0007\u001bPsecret\u001b\\\u009b32m✓\u009b0m\u009d52;hidden\u009c\u0000\u0003\t\u007f\u0085\r\n\nnext\rlast\u2028\u2029😀');
    assert.deepEqual(pasted, ['ared✓ next last 😀']);
    await ui.paste('');
    await ui.paste('\u0003\u001b[31m');
    assert.deepEqual(pasted, ['ared✓ next last 😀', '', '']);
  } finally { ui.destroy(); }
});

test('paste outside a single-line input never executes navigation, palette or quit shortcuts', async () => {
  const { ui, quit, destroy } = await setup();
  try {
    const before = ui.frame();
    await ui.paste('q2:/?\u0003\n');
    assert.equal(ui.frame(), before);
    assert.equal(quit.requested, false);
    await ui.press('?');
    assert.match(ui.frame(), /KEYBOARD MAP/);
    const help = ui.frame();
    await ui.paste('q\n\u001b');
    assert.equal(ui.frame(), help);
    assert.equal(quit.requested, false);
  } finally { destroy(); }
});
