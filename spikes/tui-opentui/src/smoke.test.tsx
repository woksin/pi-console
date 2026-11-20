import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { App } from './app.tsx';
import { Store, clean, fuzzy, type Snapshot, type Entry } from './model.ts';
import { theme, quantize } from './theme.ts';
import { timeline } from './transcript.tsx';

const fixture = JSON.parse(readFileSync(new URL('../../fixture/data/fixture.json', import.meta.url), 'utf8')) as Snapshot & { transcript: Entry[] };
function seeded() {
  const store = new Store();
  store.apply({ seq: 0, type: 'snapshot', payload: structuredClone(fixture) });
  store.append(fixture.transcript);
  store.connection(true);
  store.flush();
  return store;
}
test('native React renderer: fleet, detail, palette, search, mouse and resize', async () => {
  const store = seeded();
  const ui = await testRender(<App store={store} />, { width: 120, height: 36 });
  const key = async (name: string) => {
    await act(async () => {
      ui.mockInput.pressKey(name);
      if (name === 'ESCAPE') await new Promise(resolve => setTimeout(resolve, 40));
    });
  };
  try {
    await ui.waitForFrame(frame => frame.includes('NEEDS YOU') && frame.includes('aurora'));
    await key('RETURN');
    await ui.waitForFrame(frame => frame.includes('TRANSCRIPT') && frame.includes('INTERRUPTED'));
    await key('ARROW_UP');
    await ui.waitForFrame(frame => frame.includes('PAUSED'));
    await act(async () => {
      store.append([{ ...fixture.transcript[0], id: 'new', cursor: 2001 }]);
      store.flush();
    });
    await ui.waitForFrame(frame => frame.includes('↓ 1 new'));
    await key('f');
    await ui.waitForFrame(frame => frame.includes('following tail'));
    await key('/');
    await ui.waitForFrame(frame => frame.includes('TRANSCRIPT SEARCH'));
    await act(async () => ui.mockInput.typeText('retry'));
    await key('RETURN');
    await ui.waitForFrame(frame => frame.includes('matching “retry”'));
    await key('ESCAPE');
    await act(async () => ui.mockInput.pressKey('p', { ctrl: true }));
    await ui.waitForFrame(frame => frame.includes('COMMAND PALETTE'));
    await act(async () => ui.mockInput.typeText('theme'));
    await ui.waitForFrame(frame => frame.includes('Toggle theme'));
    await key('RETURN');
    await key('ESCAPE');
    await ui.waitForFrame(frame => frame.includes('SESSIONS'));
    await act(async () => ui.mockMouse.click(8, 15));
    await act(async () => ui.resize(200, 50));
    await ui.waitForFrame(frame => frame.includes('TOKEN BURN'));
    await act(async () => ui.resize(85, 40));
    await ui.flush();
    assert.ok(ui.captureCharFrame().includes('SESSION PREVIEW'));
  } finally { await act(async () => ui.dispose()); }
});
test('bounded transcript, deduplication, terminal safety and presentation', () => {
  const store = seeded();
  store.append(fixture.transcript);
  assert.equal(store.state.entries.get('s2')!.length, 2000);
  for (let n = 2001; n <= 8000; n++) store.append([{ ...fixture.transcript[0], cursor: n }]);
  assert.equal(store.state.entries.get('s2')!.length, 2500);
  assert.equal(clean('\x1b[31mhello\x1b[0m\x07\u202e'), 'hello');
  assert.ok(fuzzy('gts', 'Go to session'));
  assert.ok(!fuzzy('zzz', 'Go to session'));
  assert.equal(quantize('#ffffff', '16'), '#ffffff');
  const lines = timeline(fixture.transcript.slice(96, 104), store.state, theme('truecolor'), 70, new Set());
  assert.ok(lines.some(line => line.text.includes('HANDOFF')));
  assert.ok(lines.some(line => line.text.includes('carried: r1, r2')));
  assert.ok(lines.some(line => line.text.includes('origin not verified')));
});
