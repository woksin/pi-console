// TUI captures: the real TUI on a pty (xterm headless emulator), screen -> SVG -> PNG through the already-launched Chromium.
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserContext, Page } from 'playwright-core';
import { themeTokens } from '../../packages/contract/src/index.ts';
import { startPty, type Pty } from '../../packages/tui/src/testing/pty.ts';
import { screenToSvg } from '../../packages/tui/src/testing/svg.ts';
import type { Rig } from '../../packages/web/e2e/harness.ts';
import { fixedNow } from './scenes.ts';
import { withStaleQuestion } from './questions.ts';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';

const main = fileURLToPath(new URL('../../packages/tui/src/main.ts', import.meta.url));
const ctrlP = '\u0010';
const pause = async (ms = 450): Promise<void> => { await new Promise<void>(done => { setTimeout(done, ms); }); };

interface Terminal { pty: Pty; page: Page; scale: number; opaque: boolean }
interface TerminalOptions { cols: number; rows: number; theme?: string; scale: number; opaque: boolean }

function launch(rig: Rig, size: { cols: number; rows: number }, theme: string): Pty {
  const env = {
    ...process.env, COLORTERM: 'truecolor', PI_CONSOLE_THEME: theme, PI_CONSOLE_URL: `http://127.0.0.1:${String(rig.daemon.port)}`,
    PI_CONSOLE_TOKEN: rig.daemon.token, PI_CONSOLE_REDUCED_MOTION: '1', PI_CONSOLE_NOW: fixedNow, TZ: 'UTC',
  };
  return startPty(`exec node --experimental-ffi --disable-warning=ExperimentalWarning ${main}`, { ...size, env });
}

/** The settled screen as pixels. */
async function snap({ pty, page, opaque }: Terminal, title: string): Promise<Buffer> {
  await pause();
  const svg = screenToSvg(pty.terminal, { background: themeTokens.bg, foreground: themeTokens.text }, title);
  const [, width, height] = /width="(\d+)" height="(\d+)"/.exec(svg) ?? [];
  await page.setViewportSize({ width: Number(width), height: Number(height) });
  await page.setContent(`<body style="margin:0;background:${opaque ? themeTokens.bg : 'transparent'}">${svg}</body>`);
  return page.screenshot({ omitBackground: !opaque, clip: { x: 0, y: 0, width: Number(width), height: Number(height) } });
}

async function terminal(rig: Rig, options: TerminalOptions): Promise<Terminal> {
  const pty = launch(rig, options, options.theme ?? 'midnight');
  let context: BrowserContext | undefined;
  try {
    context = await rig.browser.newContext({ deviceScaleFactor: options.scale });
    await pty.waitFor(/need you|live/);
    return { pty, page: await context.newPage(), scale: options.scale, opaque: options.opaque };
  } catch (error) {
    pty.kill();
    await context?.close().catch(() => undefined);
    throw error;
  }
}

async function withTerminal(rig: Rig, options: TerminalOptions, capture: (term: Terminal) => Promise<void>): Promise<void> {
  const term = await terminal(rig, options);
  try { await capture(term); }
  finally {
    try { term.pty.kill(); }
    finally { await term.page.context().close(); }
  }
}

/** Selects the reset-bearing session by name, never by an ingestion-order-dependent fleet cursor. */
async function openSession(pty: Pty): Promise<void> {
  pty.send(':'); await pty.waitFor('Command palette');
  pty.send('@aurora implementation'); await pty.waitFor(/\b1 of \d+/);
  pty.send('\r'); await pty.waitFor('aurora implementation · L192');
  await pty.waitFor('following tail');
  // The status line shows before the first page arrives; every later key needs the loaded transcript.
  await pty.waitFor(/\d\d:\d\d:\d\d [^\n]*\S/);
}

/** Searches for the reset divider so its carried/interrupted lists are on screen. */
async function showReset(pty: Pty): Promise<void> {
  // The reset lives before the default tail page: move to its edge, then load the older page.
  pty.send('g'); await pause(500);
  for (let page = 0; page < 6 && pty.screen().includes('older entries above'); page++) {
    pty.send('g'); await pause(600);
  }
  pty.send('/'); await pause(250);
  pty.send('handoff\r'); await pty.waitFor('matching');
  // Ordinary entries mention a handoff too (135 matches) and the divider is among the oldest: load and go to the top of the
  // filtered list, then step down to it.
  for (let page = 0; page < 8 && (page === 0 || pty.screen().includes('older entries above')); page++) {
    pty.send('g'); await pause(700);
  }
  // Step until the whole reset block is on screen: the heading and its carried and interrupted request rows, not just the heading.
  const blockShown = (): boolean => { const screen = pty.screen(); return screen.includes('⟲ handoff') && /carried +r\d/.test(screen) && /interrupted +r\d/.test(screen); };
  for (let step = 0; step < 80 && !blockShown(); step++) { pty.send('j'); await pause(150); }
  if (!blockShown()) throw new Error(`The reset block (heading, carried and interrupted rows) never came fully on screen:\n${pty.screen()}`);
}

async function stills(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 110, rows: 34, scale: 2, opaque: false }, async term => {
    const { pty } = term;
    if (wanted(work, 'tui-overview')) writeStill(work, 'tui-overview', await snap(term, 'pi-console TUI overview'));
    if (wanted(work, 'tui-palette')) {
      pty.send(ctrlP); await pause(300); pty.send('aur');
      writeStill(work, 'tui-palette', await snap(term, 'pi-console TUI command palette'));
      pty.send('\u001b'); await pause(500);
    }
  });
}

/** A short terminal: the filtered transcript has only the divider in it, so a tall one would be mostly empty. */
async function sessionStill(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 110, rows: 17, scale: 2, opaque: false }, async term => {
    await openSession(term.pty);
    await showReset(term.pty);
    writeStill(work, 'tui-session-resets', await snap(term, 'pi-console TUI reset divider'));
  });
}

async function monoStill(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 110, rows: 34, theme: 'mono', scale: 2, opaque: false }, async term => {
    term.pty.send('2'); await term.pty.waitFor('Fleet');
    writeStill(work, 'tui-mono', await snap(term, 'pi-console TUI mono theme'));
  });
}

async function questionStill(rig: Rig, work: Work): Promise<void> {
  await withStaleQuestion(rig, () => withTerminal(rig, { cols: 140, rows: 30, scale: 2, opaque: false }, async term => {
    term.pty.send('4'); await term.pty.waitFor('Questions');
    if (wanted(work, 'tui-questions')) writeStill(work, 'tui-questions', await snap(term, 'pi-console TUI questions with a stale marker'));
    // The first row is the stale one; the second carries the long text and three history entries.
    term.pty.send('j'); await pause(200);
    term.pty.send('v'); await term.pty.waitFor('Keep the cache bounded');
    writeStill(work, 'tui-question-expanded', await snap(term, 'pi-console TUI expanded question'));
  }));
}

async function settingsStill(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 80, rows: 16, scale: 2, opaque: false }, async term => {
    term.pty.send(','); await term.pty.waitFor('Settings');
    for (let row = 0; row < 80; row++) { term.pty.send('j'); await pause(10); }
    await term.pty.waitFor('context ramp');
    writeStill(work, 'tui-settings-scroll', await snap(term, 'pi-console TUI Settings scrolled to the end'));
  });
}

const doneTexts = [
  'Keep the checkpoint history bounded', 'Use the shared retry helper for batch uploads', 'Run the migration dry-run before every deploy',
  'Name feature branches after the issue number', 'Log queue depth with every worker heartbeat', 'Prefer idempotent handlers for replayed events',
  'Pin the lint config before touching rules', 'Cap transcript previews at five hundred lines', 'Ask before deleting completed checkpoints',
  'Write the rollback note before merging', 'Keep release notes in the handoff', 'Review flaky specs before retrying them',
];

async function memoryStills(rig: Rig, work: Work): Promise<void> {
  const items = rig.daemon.store.memory;
  const originalLength = items.length;
  const base = items.find(item => item.sessionId === 's2')!;
  // Extend the rig's own store-local memory just for this scene: a long, believable history that is newer than every showcase item, so the proposal lies beyond the first 100 rows.
  const hour = 3600_000;
  const originalAt = items.map(item => item.at);
  for (const item of items) item.at = new Date(Date.parse(item.at) - 72 * hour).toISOString();
  items.push(...Array.from({ length: 100 }, (_, index) => ({
    ...base, id: `gallery-done-${String(index)}`, status: 'done' as const, statusBasis: 'recorded' as const,
    text: doneTexts[index % doneTexts.length]!, at: new Date(Date.parse(fixedNow) - 3 * hour - index * 15 * 60_000).toISOString(), command: null,
  })));
  try {
    await withTerminal(rig, { cols: 140, rows: 31, scale: 2, opaque: false }, async term => {
      await openSession(term.pty);
      for (let tab = 0; tab < 4; tab++) { term.pty.send('\t'); await pause(100); }
      await term.pty.waitFor('100/107 loaded');
      if (wanted(work, 'tui-memory-paging')) writeStill(work, 'tui-memory-paging', await snap(term, 'pi-console TUI memory history'));
      if (!wanted(work, 'tui-memory-review')) return;
      for (let item = 0; item < 99; item++) { term.pty.send(']'); await pause(15); }
      await term.pty.waitFor('107/107 loaded');
      // The 100 history rows are newest; the showcase proposal is the next, 101st, row.
      term.pty.send(']'); await pause(50);
      await term.pty.waitFor('/memory confirm item-2');
      writeStill(work, 'tui-memory-review', await snap(term, 'pi-console TUI older memory proposal'));
    });
  } finally { items.splice(originalLength); items.forEach((item, index) => { item.at = originalAt[index]!; }); }
}

async function attentionStill(rig: Rig, work: Work): Promise<void> {
  const server = rig.daemon.server;
  const original = server.listeners('request')[0];
  const unavailable = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.url?.startsWith('/api/v1/needs-you')) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Synthetic outage' }));
    } else original(request, response);
  };
  server.removeListener('request', original);
  server.on('request', unavailable);
  try {
    await withTerminal(rig, { cols: 110, rows: 24, scale: 2, opaque: false }, async term => {
      await term.pty.waitFor('unavailable');
      writeStill(work, 'tui-attention-retry', await snap(term, 'pi-console TUI attention unavailable'));
    });
  } finally { server.removeListener('request', unavailable); server.on('request', original); }
}

async function tourGif(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 100, rows: 30, scale: 1, opaque: true }, async term => {
    const { pty } = term;
    const frames = new FrameSet(work, 'tui-tour');
    const hold = async (ms: number): Promise<void> => { frames.add(await snap(term, 'pi-console TUI tour'), ms); };
    await hold(900);
    pty.send('2'); await pty.waitFor('Fleet'); await hold(900);
    await openSession(pty); await hold(900);
    await showReset(pty); await hold(1400);
    pty.send('\u001b'); await pause(300);
    pty.send(ctrlP); await pause(300); await hold(500);
    for (const letter of 'aur') { pty.send(letter); await hold(200); }
    await hold(800);
    pty.send('\u001b'); await pause(300);
    pty.send('6'); await pty.waitFor('Timeline'); await hold(1400);
    frames.finish();
  });
}

const scenes = [
  { ids: ['tui-overview', 'tui-palette'], capture: stills },
  { ids: ['tui-session-resets'], capture: sessionStill },
  { ids: ['tui-mono'], capture: monoStill },
  { ids: ['tui-question-expanded', 'tui-questions'], capture: questionStill },
  { ids: ['tui-settings-scroll'], capture: settingsStill },
  { ids: ['tui-memory-paging', 'tui-memory-review'], capture: memoryStills },
  { ids: ['tui-attention-retry'], capture: attentionStill },
  { ids: ['tui-tour'], capture: tourGif },
];

export async function captureTui(rig: Rig, work: Work): Promise<void> {
  for (const scene of scenes) {
    if (scene.ids.some(id => wanted(work, id))) await scene.capture(rig, work);
  }
}
