import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Header, banner, pulseLine, terminalTitle } from './chrome.ts';
import { initial } from '../state/ui.ts';
import { Screen, Text, h, mountHeadless } from '../view/renderer.ts';
import type { Connection } from '../store/store.ts';
import type { Session } from '@pi-console/contract';
import { palette } from '../view/theme.ts';
import { pulseViewModel } from '@pi-console/viewmodels';
import { generate, needsYou } from '@pi-console/testkit';

const items = needsYou(generate().fixture).items;
const loadedAttention = { needsYou: items, needsYouLoaded: true, needsYouError: false, needsYouCached: true };

test('mono pulse uses the shared status glyphs rather than a solid white run', () => {
  const statuses = ['needs-you', 'blocked', 'failed', 'working', 'waiting', 'idle', 'done'] as const;
  const sessions = statuses.map((status, id) => ({ id: String(id), status, repositoryId: 'repo', laneId: 'main', name: status, samples: [] }) as unknown as Session);
  const pulse = pulseViewModel({ sessions, needsYou: 1 });
  palette.configure('truecolor', 'mono');
  try {
    const line = pulseLine(pulse, 160).map(part => part.text).join('');
    for (const cell of pulse.cells) assert.ok(line.includes(cell.monoGlyph));
    assert.equal(new Set(pulse.cells.map(cell => cell.monoGlyph)).size, statuses.length);
    assert.doesNotMatch(line, /[█▄▆]/);
  } finally { palette.configure('truecolor', 'midnight'); }
});

const offline: Connection = { connected: false, error: 'terminated', lastSeq: 42, lastEventAt: Date.parse('2026-11-20T12:00:03Z'), eventsReceived: 1 };

const attentionStates = [
  { name: 'loading', attention: { ...loadedAttention, needsYou: [], needsYouLoaded: false, needsYouCached: false }, expected: /checking…/ },
  { name: 'failed first load', attention: { ...loadedAttention, needsYou: [], needsYouLoaded: false, needsYouError: true, needsYouCached: false }, expected: /unavailable/ },
  { name: 'loaded empty', attention: { ...loadedAttention, needsYou: [] }, expected: /●/ },
  { name: 'loaded non-empty', attention: loadedAttention, expected: new RegExp(`(?:!|●) ${String(items.length)}(?: need you)? `) },
  { name: 'failed refresh with cached empty list', attention: { ...loadedAttention, needsYou: [], needsYouLoaded: false, needsYouError: true }, expected: /0 (?:need you · )?stale/ },
  { name: 'failed refresh with cached items', attention: { ...loadedAttention, needsYouLoaded: false, needsYouError: true }, expected: new RegExp(`${String(items.length)} (?:need you · )?stale`) },
];

for (const theme of ['midnight', 'contrast', 'mono'] as const) {
  for (const width of [80, 112, 160]) {
    for (const state of attentionStates) {
      test(`header: ${state.name} at ${String(width)} columns in ${theme}`, async () => {
        palette.configure('truecolor', theme);
        const ui = await mountHeadless(h(Screen, {}, h(Header, { ui: initial, width, attention: state.attention, connection: offline, select: () => undefined })), { width, height: 2 });
        try {
          await ui.settle();
          const frame = ui.frame();
          assert.match(frame, state.expected);
          assert.match(frame, /◌ offline/);
          for (let key = 1; key <= 7; key++) assert.ok(frame.includes(` ${String(key)} `));
          for (const line of frame.split('\n')) assert.ok(Array.from(line).length <= width);
          if (!state.attention.needsYouLoaded) assert.doesNotMatch(frame, /all clear/);
          if (state.name === 'loaded empty' && width === 160) assert.match(frame, /● all clear/);
        } finally { ui.destroy(); palette.configure('truecolor', 'midnight'); }
      });
    }
  }
}

test('100-column header keeps all tab numbers, the active label and an explicit attention glyph', async () => {
  const ui = await mountHeadless(h(Screen, {}, h(Header, { ui: { ...initial, section: 'fleet' }, width: 100, attention: { ...loadedAttention, needsYou: Array.from({ length: 19 }, () => items[0]) }, connection: { ...offline, connected: true }, select: () => undefined })), { width: 100, height: 30 });
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

for (const lastEventAt of [undefined, offline.lastEventAt]) {
  test(`offline banner names the attempted URL with last event ${String(lastEventAt)}`, async () => {
    const endpoint = 'http://127.0.0.1:5888';
    const line = banner({ ...offline, lastEventAt }, 80, endpoint);
    assert.ok(line);
    const ui = await mountHeadless(h(Screen, {}, h(Text, { line })), { width: 80, height: 2 });
    try {
      await ui.settle();
      assert.ok(ui.frame().includes(endpoint));
      assert.match(ui.frame(), /Daemon unreachable/);
      assert.equal(banner({ ...offline, connected: true }, 80, endpoint), undefined);
    } finally { ui.destroy(); }
  });
}

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

test('the pulse row shows one cell per session, activity and the counts, and collapses cells it cannot fit', async () => {
  const { pulseViewModel } = await import('@pi-console/viewmodels');
  const { fixture } = (await import('@pi-console/testkit')).generate();
  const sessions = (fixture as unknown as { sessions: Session[] }).sessions;
  const pulse = pulseViewModel({ sessions, needsYou: 16 });
  const text = (width: number) => pulseLine(pulse, width).map(part => part.text).join('');
  const wide = text(132);
  assert.equal(Array.from(wide).length, 132);
  assert.equal(Array.from(wide).filter(cell => '█▆▄'.includes(cell)).length, sessions.length);
  assert.match(wide, /activity [\u2800-\u28ff]{12}/);
  assert.match(wide, /30 sessions · \d+ working $/);
  assert.doesNotMatch(wide, /need you/);
  const medium = text(80);
  assert.equal(Array.from(medium).filter(cell => '█▆▄'.includes(cell)).length, sessions.length, 'activity gives way before any session cell does');
  assert.doesNotMatch(medium, /activity|\+\d+/);
  const narrow = text(60);
  assert.equal(Array.from(narrow).length, 60);
  assert.match(narrow, /\+\d+/);
  assert.doesNotMatch(narrow, /activity/);
});
