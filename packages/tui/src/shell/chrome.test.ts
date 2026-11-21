import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Header, banner } from './chrome.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import type { Connection } from '../store/store.ts';

const offline: Connection = { connected: false, error: 'terminated', lastSeq: 42, lastEventAt: Date.parse('2026-11-20T12:00:03Z'), eventsReceived: 1 };

test('100-column header keeps all tab numbers, the active label and an explicit attention glyph', async () => {
  const ui = await mountHeadless(h(Screen, {}, h(Header, { ui: { ...initial, section: 'fleet' }, width: 100, attention: 19, connection: { ...offline, connected: true }, select: () => undefined })), { width: 100, height: 30 });
  try {
    const frame = await ui.waitFor('! 19');
    for (let key = 1; key <= 7; key++) assert.ok(frame.includes(` ${String(key)} `));
    assert.match(frame, /2\s+Fleet/);
    assert.match(frame, /◉ live/);
  } finally { ui.destroy(); }
});

test('reconnect banner shows human wording, as-of time and retrying at 80 columns', () => {
  const text = banner(offline, 80)?.map(part => part.text).join('');
  assert.match(text ?? '', /Daemon unreachable · showing data as of 12:00:03 UTC · retrying/);
  assert.doesNotMatch(text ?? '', /terminated|#42/);
  assert.equal(banner({ ...offline, connected: true }, 80), undefined);
});
