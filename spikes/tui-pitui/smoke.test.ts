import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { TuiAltScreen, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui';
import { App } from './app.ts';
import { Frames } from './client.ts';
import { Model, RETAIN, fleetRows, origin } from './model.ts';
import { clean } from './paint.ts';
import { colorDepth } from './main.ts';

function setup() {
  const { transcript, ...snapshot } = JSON.parse(readFileSync(new URL('../fixture/data/fixture.json', import.meta.url), 'utf8'));
  const model = new Model();
  model.apply({ type: 'snapshot', seq: 0, payload: snapshot });
  model.mergeHistory('s2', transcript);
  model.connected = true;
  const app = new App(model, 'truecolor');
  return { model, app, transcript };
}

const plain = (app: App, width = 120) => app.render(width).map(stripTerminalSequences).join('\n');

test('fleet + detail reflow exactly to both requested viewports and small terminal fallback', () => {
  const { model, app } = setup();
  for (const [width, height] of [[120, 36], [200, 50], [80, 24], [60, 15]]) {
    app.height = () => height;
    for (const screen of ['fleet', 'detail'] as const) {
      model.screen = screen;
      const lines = app.render(width);
      assert.equal(lines.length, height);
      lines.forEach((line, i) => assert.equal(visibleWidth(line), width, `${screen} row ${i}: ${stripTerminalSequences(line)}`));
    }
  }
});

test('fleet hierarchy, selection, palette fuzzy lookup, filter, theme and keyboard help', () => {
  const { model, app } = setup();
  assert.match(plain(app), /NEEDS YOU/);
  const rows = fleetRows(model).flatMap(row => row.session ? [row.session.id] : []);
  assert.deepEqual(rows.slice(0, 5), ['s1', 's2', 's4', 's5', 's3']);
  app.handleInput('j');
  assert.equal(model.selected, 's4');
  app.handleInput(':');
  for (const char of 'L192 aurora') app.handleInput(char);
  assert.match(plain(app), /Go to session L192/);
  app.handleInput('\r');
  assert.equal(model.screen, 'detail');
  assert.equal(model.selected, 's2');
  app.handleInput('\x1b');
  assert.equal(model.screen, 'fleet');
  app.handleInput('!');
  assert(model.sessions.every(session => session.status === 'needs-you'));
  app.handleInput('t');
  assert(app.paint.contrast);
  app.handleInput('?');
  assert.match(plain(app), /FIELD GUIDE/);
  app.handleInput('\x1b');
  assert.equal(app.overlay, undefined);
});

test('detail preserves origins, interrupted requests, diffs, resets and collapse state', () => {
  const { model, app } = setup();
  app.openSession('s2');
  app.handleInput('r');
  const rendered = plain(app);
  assert.match(rendered, /RESET \/ handoff \/ reset1/);
  assert.match(rendered, /carried: r1, r2/);
  assert.match(rendered, /INTERRUPTED/);
  assert.match(rendered, /origin not verified/);
  assert.match(rendered, /retryLimit = 4/);
  assert.match(rendered, /initial prompt/);
  assert.equal(origin(model.data.requests[0]), 'you');
  app.handleInput('\r');
  assert(model.expanded.size > 0);
  assert.match(plain(app), /exit status not supplied/);
});

test('follow pauses on scroll, counts new entries, stays anchored and resumes; search is cancellable', () => {
  const { model, app, transcript } = setup();
  app.openSession('s2');
  app.render(120);
  app.handleInput('k');
  app.render(120);
  const before = app.transcript.hits[0].entry.id;
  model.apply({ type: 'transcript.appended', seq: 1, payload: { ...transcript[0], id: 'new-entry', cursor: 2001 } });
  assert.equal(model.follow, false);
  assert.equal(model.unseen, 1);
  assert.match(plain(app), /1 new/);
  assert.equal(app.transcript.hits[0].entry.id, before);
  app.handleInput('/');
  for (const char of 'bounded') app.handleInput(char);
  app.handleInput('\r');
  assert.equal(model.search, 'bounded');
  assert(app.transcript.hits.length > 0);
  app.handleInput('\x1b');
  assert.equal(model.search, '');
  app.handleInput('f');
  assert(model.follow);
  assert.equal(model.unseen, 0);
});

test('mouse click selection, double click detail and wheel scrolling', () => {
  const { model, app } = setup();
  app.render(120);
  const hit = app.fleetHits.find(row => row.id === 's2')!;
  const event = { type: 'click', button: 'left', x: 12, y: hit.y + 4, screenX: 12, screenY: hit.y + 4, width: 120, height: 36, shift: false, alt: false, ctrl: false, clickCount: 2 } as const;
  app.handleMouse(event);
  assert.equal(model.selected, 's2');
  assert.equal(model.screen, 'detail');
  app.handleMouse({ ...event, type: 'wheel', wheelDelta: -3 });
  assert.equal(model.follow, false);
  app.handleInput('\t');
  assert.equal(model.focus, 1);
});

test('stream parser handles split frames, CRLF, heartbeat comments and multiple events', () => {
  const frames = new Frames();
  assert.deepEqual(frames.push(': heartbeat\r\n\r\ndata: {"seq":'), []);
  assert.deepEqual(frames.push('1,"type":"snapshot","payload":{}}\r\n\r\n'), [{ seq: 1, type: 'snapshot', payload: {} }]);
  assert.equal(frames.buffer, '');
});

test('stress projection stays bounded, deduplicates cursor history and keeps live events during pagination', () => {
  const { model, transcript } = setup();
  for (let i = 2001; i <= 102000; i++) model.apply({ seq: i, type: 'transcript.appended', payload: { ...transcript[i % 2000], cursor: i, id: `live-${i}` } });
  assert(model.transcript.length <= RETAIN + 500);
  model.mergeHistory('s2', transcript);
  assert.equal(model.transcript.at(-1)?.cursor, 102000);
  assert.equal(model.transcript.length, RETAIN);
  assert.equal(new Set(model.transcript.map(entry => entry.cursor)).size, RETAIN);
});

test('untrusted terminal sequences are stripped; colour fallback does not emit truecolour', () => {
  assert.equal(clean('\x1b[31mhello\x1b[0m\x1b]52;c;YQ==\x07\x00\x1b[2J'), 'hello');
  assert.equal(colorDepth({ COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(colorDepth({ TERM: 'xterm-256color' }), '256');
  assert.equal(colorDepth({ TERM: 'vt100' }), '16');
  const { app } = setup();
  for (const depth of ['16', '256'] as const) {
    app.paint.depth = depth;
    assert(!app.render(120).join('').includes(';2;'));
    assert.match(plain(app), /working/);
  }
});

test('real pi-tui alternate-screen renderer starts, handles input, resizes and restores terminal headlessly', async () => {
  const { app } = setup();
  const output: string[] = [];
  let input = (_data: string) => {};
  let resize = () => {};
  const terminal = {
    columns: 120, rows: 36, kittyProtocolActive: false,
    start(onInput: typeof input, onResize: typeof resize) { input = onInput; resize = onResize; },
    stop() {}, write(data: string) { output.push(data); }, async drainInput() {},
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {},
    clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
  app.height = () => terminal.rows;
  app.redraw = () => tui.requestRender();
  tui.setLayoutRoot(app);
  tui.setFocus(app);
  tui.start();
  try {
    await delay(40);
    input('\r');
    await delay(40);
    terminal.columns = 200;
    terminal.rows = 50;
    resize();
    await delay(40);
    assert.equal(app.model.screen, 'detail');
    assert.equal(app.width, 200);
    assert.match(output.join(''), /TRANSCRIPT/);
    assert.match(output.join(''), /\x1b\[\?1049h/);
  } finally { tui.stop(); }
  assert.match(output.join(''), /\x1b\[\?1049l/);
});
