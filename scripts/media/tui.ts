// TUI captures: the real TUI on a pty (xterm headless emulator), screen -> SVG -> PNG through the already-launched Chromium.
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright-core';
import { themeTokens } from '../../packages/contract/src/index.ts';
import { startPty, type Pty } from '../../packages/tui/src/testing/pty.ts';
import { screenToSvg } from '../../packages/tui/src/testing/svg.ts';
import type { Rig } from '../../packages/web/e2e/harness.ts';
import { fixedNow } from './scenes.ts';
import { FrameSet, wanted, writeStill, type Work } from './capture.ts';

const main = fileURLToPath(new URL('../../packages/tui/src/main.ts', import.meta.url));
const ctrlP = '\u0010';
const pause = async (ms = 450): Promise<void> => { await new Promise<void>(done => { setTimeout(done, ms); }); };

interface Terminal { pty: Pty; page: Page; scale: number; opaque: boolean }
interface TerminalOptions { cols: number; rows: number; theme?: string; scale: number; opaque: boolean }

function launch(rig: Rig, size: { cols: number; rows: number }, theme: string): Pty {
  const env = {
    ...process.env, COLORTERM: 'truecolor', PI_CONSOLE_THEME: theme, PI_CONSOLE_URL: `http://127.0.0.1:${String(rig.daemon.port)}`,
    PI_CONSOLE_TOKEN: rig.daemon.token, PI_CONSOLE_REDUCED_MOTION: '1', PI_CONSOLE_NOW: fixedNow,
  };
  return startPty(`exec node --experimental-ffi --disable-warning=ExperimentalWarning ${main}`, { ...size, env });
}

/** The settled screen as pixels. */
async function snap({ pty, page, scale, opaque }: Terminal, title: string): Promise<Buffer> {
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
  pty.send('\r'); await pty.waitFor('aurora / L192 / aurora implementation');
  await pty.waitFor('following tail');
}

/** Searches for the reset divider so its carried/interrupted lists are on screen. */
async function openSessionAtReset(pty: Pty): Promise<void> {
  await openSession(pty);
  pty.send('/'); await pause(250);
  pty.send('handoff\r'); await pty.waitFor('⟲ handoff');
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
    await openSessionAtReset(term.pty);
    writeStill(work, 'tui-session-resets', await snap(term, 'pi-console TUI reset divider'));
  });
}

async function monoStill(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 110, rows: 34, theme: 'mono', scale: 2, opaque: false }, async term => {
    term.pty.send('2'); await term.pty.waitFor('Fleet');
    writeStill(work, 'tui-mono', await snap(term, 'pi-console TUI mono theme'));
  });
}

async function tourGif(rig: Rig, work: Work): Promise<void> {
  await withTerminal(rig, { cols: 100, rows: 30, scale: 1, opaque: true }, async term => {
    const { pty } = term;
    const frames = new FrameSet(work, 'tui-tour');
    const hold = async (ms: number): Promise<void> => { frames.add(await snap(term, 'pi-console TUI tour'), ms); };
    await hold(900);
    pty.send('2'); await pty.waitFor('Fleet'); await hold(900);
    await openSession(pty); await hold(900);
    pty.send('/'); await pause(250); pty.send('handoff\r'); await pty.waitFor('⟲ handoff'); await hold(1400);
    pty.send('\u001b'); await pause(300);
    pty.send(ctrlP); await pause(300); await hold(500);
    for (const letter of 'aur') { pty.send(letter); await hold(200); }
    await hold(800);
    pty.send('\u001b'); await pause(300);
    pty.send('6'); await pty.waitFor('Timeline'); await hold(1400);
    frames.finish();
  });
}

export async function captureTui(rig: Rig, work: Work): Promise<void> {
  if (['tui-overview', 'tui-palette'].some(id => wanted(work, id))) await stills(rig, work);
  if (wanted(work, 'tui-session-resets')) await sessionStill(rig, work);
  if (wanted(work, 'tui-mono')) await monoStill(rig, work);
  if (wanted(work, 'tui-tour')) await tourGif(rig, work);
}
