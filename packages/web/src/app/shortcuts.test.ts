import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { PaletteItem } from '@pi-console/viewmodels';
import { pickTarget, type Overlay } from './shortcuts.ts';

function browserFor(t: TestContext) {
  const pending: (() => void)[] = [];
  const browser = { location: { hash: '' }, setTimeout: (callback: () => void) => { pending.push(callback); return 0; } };
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  t.after(() => { Reflect.deleteProperty(globalThis, 'window'); });
  return { browser, pending };
}

function item(target: PaletteItem['target']): PaletteItem {
  return { id: 'pick', group: 'Command', label: 'Pick', detail: '', key: '', glyph: '›', tone: 'muted', status: '', segments: [], target };
}

test('palette session targets retain their exact entry navigation after shortcut extraction', t => {
  const { browser, pending } = browserFor(t);
  const overlays: Overlay[] = [];
  pickTarget(item({ kind: 'session', sessionId: 's1', entryId: 'e42' }), overlay => { overlays.push(overlay); });
  assert.equal(browser.location.hash, '/session/s1?entry=e42');
  assert.deepEqual(overlays, []);
  assert.deepEqual(pending, []);
});

test('global palette targets still act immediately instead of being deferred to the reader', t => {
  const { browser, pending } = browserFor(t);
  const overlays: Overlay[] = [];
  const setOverlay = (overlay: Overlay): void => { overlays.push(overlay); };
  pickTarget(item({ kind: 'action', action: 'palette.open' }), setOverlay);
  pickTarget(item({ kind: 'action', action: 'help.toggle' }), setOverlay);
  pickTarget(item({ kind: 'action', action: 'settings.open' }), setOverlay);
  assert.deepEqual(overlays, ['palette', 'help']);
  assert.equal(browser.location.hash, '/settings');
  assert.deepEqual(pending, []);
});

test('view actions picked in the palette remain deferred until the palette has closed', t => {
  const { browser, pending } = browserFor(t);
  const overlays: Overlay[] = [];
  pickTarget(item({ kind: 'action', action: 'follow.toggle' }), overlay => { overlays.push(overlay); });
  assert.equal(pending.length, 1);
  assert.equal(browser.location.hash, '');
  assert.deepEqual(overlays, []);
  pending[0]();
});
