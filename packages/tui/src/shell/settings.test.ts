import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../app.ts';
import { countsOf } from '../app-input.ts';
import { Store } from '../store/store.ts';
import { h, mountHeadless } from '../view/renderer.ts';
import { settingsViewport } from './overlays.ts';

async function settingsAt(size: { width: number; height: number }) {
  const store = new Store();
  const input = { endpoint: 'http://localhost', tokenSource: 'test', ...store.getSnapshot().connection, now: 0, counts: countsOf(store.getSnapshot()) };
  const ui = await mountHeadless(h(App, { store, endpoint: input.endpoint, tokenSource: input.tokenSource, animate: false, clock: () => 0, loadTranscript: () => undefined, loadMemory: () => undefined, onQuit: () => undefined }), size);
  await ui.settle();
  await ui.press(',');
  return { ui, input, destroy: () => { ui.destroy(); store.dispose(); } };
}

const textOf = (frame: string): string => frame.replace(/[│\s]+/g, ' ');

for (const size of [{ width: 80, height: 24 }, { width: 60, height: 16 }]) {
  test(`${size.width}x${size.height}: Settings keyboard scrolling reaches every row and shows its position`, async () => {
    const { ui, input, destroy } = await settingsAt(size);
    try {
      const viewport = settingsViewport(size, input);
      const { page, max } = viewport.bounds;
      const first = ui.frame();
      assert.equal(viewport.lines.length, 25);
      assert.equal(page, size.height - 4);
      assert.ok(first.includes(`1–${page} of 25`));
      assert.match(first, /↑↓ PgUp\/PgDn Home\/End · esc closes/);
      assert.doesNotMatch(first, /context ramp/);
      let seen = first;
      for (let line = 0; line < max; line++) { await ui.press('ARROW_DOWN'); seen += ui.frame(); }
      for (const line of viewport.lines) {
        const text = line.map(part => part.text).join('').slice(0, 32).trim();
        assert.ok(textOf(seen).includes(textOf(text)), text);
      }
      const last = ui.frame();
      assert.ok(last.includes(`${max + 1}–25 of 25`));
      assert.match(last, /context ramp/);
      await ui.press('ARROW_DOWN');
      assert.equal(ui.frame(), last, 'clamped at the end');
      await ui.press('HOME');
      assert.equal(ui.frame(), first);
      await ui.press('ESCAPE');
      assert.doesNotMatch(ui.frame(), /Settings/);
      await ui.press(',');
      assert.equal(ui.frame(), first, 'reopening resets scroll');
    } finally { destroy(); }
  });

  test(`${size.width}x${size.height}: Settings accepts Help's scrolling keys without moving the underlying view`, async () => {
    const { ui, destroy } = await settingsAt(size);
    try {
      const first = ui.frame();
      for (const [down, up] of [['ARROW_DOWN', 'ARROW_UP'], ['j', 'k'], ['\u001b[6~', '\u001b[5~']]) {
        await ui.press(down);
        assert.notEqual(ui.frame(), first, down);
        await ui.press(up);
        assert.equal(ui.frame(), first, up);
      }
      await ui.press('END');
      const last = ui.frame();
      await ui.press('g');
      assert.equal(ui.frame(), first);
      await ui.press('G');
      assert.equal(ui.frame(), last);
      await ui.press('?');
      assert.match(ui.frame(), /KEYBOARD MAP/);
      await ui.press('ESCAPE');
      await ui.press(',');
      assert.equal(ui.frame(), first);
    } finally { destroy(); }
  });
}

test('Settings resize clamps the visible offset and the next key starts from that clamped position', async () => {
  const { ui, destroy } = await settingsAt({ width: 60, height: 16 });
  try {
    await ui.press('END');
    assert.ok(ui.frame().includes('14–25 of 25'));
    await ui.resize(80, 24);
    assert.ok(ui.frame().includes('6–25 of 25'));
    assert.match(ui.frame(), /context ramp/);
    await ui.press('ARROW_UP');
    assert.ok(ui.frame().includes('5–24 of 25'));
    await ui.resize(60, 16);
    assert.ok(ui.frame().includes('5–16 of 25'));
    await ui.press('END');
    assert.ok(ui.frame().includes('14–25 of 25'));
  } finally { destroy(); }
});
