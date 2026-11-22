import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleKey, initial, reduce, type Bounds, type UiState } from './ui.ts';

const bounds: Bounds = { length: 10, page: 5, fit: { start: 0, span: 1000 }, width: 80, rowAt: () => ({ sessionId: null, groupId: null }), transcript: { keys: [], ends: [] }, viewport: 10, help: { page: 7, max: 40 }, settings: { page: 5, max: 20 } };

for (const overlay of ['help', 'settings'] as const) {
  const field = overlay === 'help' ? 'helpScroll' : 'settingsScroll';
  const other = overlay === 'help' ? 'settingsScroll' : 'helpScroll';
  const state: UiState = { ...initial, overlay, sessionId: 's1', [field]: 10, [other]: 3 };
  const { page, max } = bounds[overlay]!;
  const positions = { ArrowUp: 9, k: 9, ArrowDown: 11, j: 11, PageUp: 10 - page, PageDown: 10 + page, Home: 0, g: 0, End: max, G: max };

  test(`${overlay}: Help's keys change only the active overlay's scroll position`, () => {
    for (const [key, position] of Object.entries(positions)) {
      assert.deepEqual(handleKey(state, key, bounds), { ...state, [field]: position }, key);
    }
    assert.deepEqual(handleKey({ ...state, [field]: max }, 'ArrowDown', bounds), { ...state, [field]: max });
    assert.deepEqual(handleKey({ ...state, [field]: 0 }, 'ArrowUp', bounds), { ...state, [field]: 0 });
    assert.deepEqual(handleKey(state, 'Esc', bounds), { ...state, overlay: 'none', input: '' });
  });

  test(`${overlay}: navigation clamps a stale offset after resize before moving`, () => {
    const resized = { ...bounds, [overlay]: { page: 15, max: 5 } };
    assert.deepEqual(handleKey(state, 'ArrowUp', resized), { ...state, [field]: 4 });
    assert.deepEqual(handleKey(state, 'PageUp', resized), { ...state, [field]: 0 });
    assert.deepEqual(handleKey(state, 'ArrowDown', resized), { ...state, [field]: 5 });
  });
}

test('opening Settings resets only its scroll and leaves the current session and Help position alone', () => {
  const state = { ...initial, sessionId: 's1', helpScroll: 8, settingsScroll: 12 };
  assert.deepEqual(reduce(state, 'settings.open', bounds), { ...state, overlay: 'settings', settingsScroll: 0 });
});
