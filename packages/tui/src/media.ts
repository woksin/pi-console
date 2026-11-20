// Regenerates docs/media/tui/*: `npm run media -w @pi-console/tui`. Drives the real TUI on a pty against the mock daemon,
// so the pictures are what a terminal shows, not a mock-up. Colour comes from the emulator's cell attributes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeTokens } from '@pi-console/contract';
import { startDaemon } from '@pi-console/testkit';
import { startPty } from './testing/pty.ts';
import { screenToSvg, toCast } from './testing/svg.ts';

const main = fileURLToPath(new URL('./main.ts', import.meta.url));
const out = fileURLToPath(new URL('../../../docs/media/tui/', import.meta.url));
const size = { cols: 132, rows: 40 };
const pause = async (ms: number) => { await new Promise(resolveWait => setTimeout(resolveWait, ms)); };

mkdirSync(out, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'pi-console-media-'));
// Deterministic pictures: fixed port (shown in Settings), a frozen mock stream (speed ≈ 0 publishes only the t=0 events) and a fixed clock.
const daemon = await startDaemon({ port: Number(process.env.PI_CONSOLE_MEDIA_PORT ?? 47777), speed: 1e-9, dataDirectory: directory });
const pty = startPty(`exec node --experimental-ffi --disable-warning=ExperimentalWarning ${main}`, {
  ...size, env: { ...process.env, COLORTERM: 'truecolor', PI_CONSOLE_URL: `http://127.0.0.1:${String(daemon.port)}`, PI_CONSOLE_TOKEN: daemon.token, PI_CONSOLE_REDUCED_MOTION: '1', PI_CONSOLE_NOW: '2026-11-20T12:00:00Z' },
});
const theme = { background: themeTokens.bg, foreground: themeTokens.text };

// The tour is one frame per picture on a fixed one-second beat, each the settled screen text (the same as the .txt): the raw
// bytes and timing the pty delivers vary run to run, which would make the cast differ on every regeneration.
const frames: { at: number; data: string }[] = [];
const markFrame = () => { frames.push({ at: (frames.length + 1) * 1000, data: `\u001b[2J\u001b[H${pty.screen().replace(/ +$/gm, '').replace(/\n/g, '\r\n')}` }); };
const shoot = (name: string, title: string) => {
  markFrame();
  writeFileSync(join(out, `${name}.svg`), screenToSvg(pty.terminal, theme, title));
  writeFileSync(join(out, `${name}.txt`), `${pty.screen().replace(/ +$/gm, '')}\n`);
  console.log(`wrote ${name}`);
};
const step = async (keys: string, marker: string | RegExp, name?: string, title?: string) => {
  pty.send(keys);
  await pty.waitFor(marker);
  await pause(350);
  if (name) shoot(name, title ?? name);
};

try {
  await pty.waitFor(/need you[\s\S]*live/);
  await pause(1500);
  shoot('overview', 'Overview: what needs you');
  await step('2', 'Fleet ·', 'fleet', 'Fleet grouped by repository');
  await step('jj', 'aurora implementation');
  await step('\r', 'Transcript', undefined);
  await pause(1500);
  shoot('session', 'Session transcript with right rail');
  await step('\u001b', 'Fleet ·');
  await step('3', 'Requests', 'requests', 'Requests and answers');
  await step('4', 'Questions', 'questions', 'Questions');
  await step('5', 'Messages', 'messages', 'Inter-agent messages');
  await step('v', 'Communication graph', 'graph', 'Communication graph');
  await step('v', 'Messages');
  await step('6', 'Timeline', 'timeline', 'Timeline');
  await step('7', 'Work', 'work', 'Work');
  await step('1', 'things need you');
  await step(':', 'Command palette', 'palette', 'Command palette');
  await step('\u001b', 'things need you');
  await step('?', 'KEYBOARD MAP', 'help', 'Help: shared keymap');
  await step('\u001b', 'things need you');
  await step(',', 'Settings', 'settings', 'Settings and health');
  await step('\u001b', 'things need you');
  await daemon.close();
  await pty.waitFor('retrying', 20000);
  await pause(300);
  shoot('reconnecting', 'Reconnect banner while the daemon is away');
  writeFileSync(join(out, 'tour.cast'), toCast(frames, size, 'pi-console TUI tour against the mock daemon'));
  console.log(`wrote tour.cast (${String(frames.length)} frames)`);
} finally {
  pty.kill();
  rmSync(directory, { recursive: true, force: true });
}
process.exit(0);
