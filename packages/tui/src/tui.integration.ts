// First-release runtime check: the real TUI process on a real pty against the mock daemon. Run on macOS or, for the
// Linux evidence, inside the container via scripts/tui-linux.sh. Not part of the Tier 1 gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startDaemon } from '@pi-console/testkit';
import { startPty, type Pty } from './testing/pty.ts';

const main = fileURLToPath(new URL('./main.ts', import.meta.url));
const freePort = async (): Promise<number> => await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as { port: number }; probe.close(() => { resolvePort(port); }); });
});

let daemon: Awaited<ReturnType<typeof startDaemon>>;
let directory: string;
let pty: Pty;
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'pi-console-pty-'));
  daemon = await startDaemon({ port: await freePort(), dataDirectory: directory });
  pty = startPty(`exec node --experimental-ffi --disable-warning=ExperimentalWarning ${main}`, {
    cols: 140, rows: 42, env: { ...process.env, PI_CONSOLE_URL: `http://127.0.0.1:${String(daemon.port)}`, PI_CONSOLE_TOKEN: daemon.token, PI_CONSOLE_REDUCED_MOTION: '1' },
  });
});
after(async () => { pty.kill(); await daemon.close(); rmSync(directory, { recursive: true, force: true }); });

test('the TUI starts, connects and shows the overview', async () => {
  const screen = await pty.waitFor(/need you[\s\S]*live/);
  assert.match(screen, /π console/);
});

test('every view is reachable by number key', async () => {
  for (const [key, marker] of [['2', 'Fleet ·'], ['3', 'Requests'], ['4', 'Questions'], ['5', 'Messages'], ['6', 'Timeline'], ['7', 'Work']] as const) {
    pty.send(key);
    await pty.waitFor(marker);
  }
  pty.send('1');
  await pty.waitFor('things need you');
});

test('the palette opens, a session opens and escape returns', async () => {
  pty.send(':');
  await pty.waitFor('Command palette');
  pty.send('@');
  pty.send('\r');
  await pty.waitFor('Transcript');
  pty.send('\u001b');
  await pty.waitFor('things need you');
});

test('q exits cleanly with status 0', async () => {
  pty.send('q');
  assert.equal(await pty.exit, 0);
});
