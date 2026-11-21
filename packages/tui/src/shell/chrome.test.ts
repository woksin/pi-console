import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Header, banner, terminalTitle } from './chrome.ts';
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

test('the OSC 2 terminal title leads with the needs-you count and strips control characters from a hostile session name', () => {
  const hostile = { id: 's9', name: 'pwn\u001b]2;owned\u0007\u001b[2J\u009b31m\r\nrm -rf\u0000' };
  const data = { needsYou: [1, 2, 3], sessions: [hostile] };
  assert.equal(terminalTitle({ section: 'fleet', sessionId: null }, data), '(3) Fleet · pi console');
  const title = terminalTitle({ section: 'fleet', sessionId: 's9' }, data);
  // eslint-disable-next-line no-control-regex -- asserting no control characters survive
  assert.doesNotMatch(title, /[\u0000-\u001f\u007f-\u009f]/);
  assert.match(title, /^\(3\) pwn.* · pi console$/);
  assert.equal(terminalTitle({ section: 'work', sessionId: null }, { needsYou: [], sessions: [] }), 'Work · pi console');
});
