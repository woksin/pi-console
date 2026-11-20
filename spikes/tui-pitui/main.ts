import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessTerminal, TuiAltScreen } from '@earendil-works/pi-tui';
import { App } from './app.ts';
import { Client } from './client.ts';
import { Model } from './model.ts';
import type { Depth } from './paint.ts';

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

export function colorDepth(env: NodeJS.ProcessEnv): Depth {
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor';
  return env.TERM?.includes('256color') ? '256' : '16';
}

export async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const depth = option('--colors', colorDepth(process.env));
  if (!['16', '256', 'truecolor'].includes(depth)) throw new Error('--colors must be 16, 256 or truecolor');
  const tokenPath = option('--token-file', resolve(root, '.pi-console-dev/token'));
  const token = readFileSync(tokenPath, 'utf8').trim();
  const model = new Model();
  const client = new Client(model, option('--url', 'http://127.0.0.1:4777'), token);
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true, copyOnSelect: false });
  const app = new App(model, depth as Depth);
  app.height = () => terminal.rows || 36;
  app.redraw = () => tui.requestRender();
  app.open = id => { void client.history(id); };
  tui.setLayoutRoot(app);
  tui.setFocus(app);
  let finished = false;
  let timer: ReturnType<typeof setInterval>;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  app.quit = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    clearTimeout(deadline);
    client.close();
    tui.stop();
    process.stdin.pause();
  };
  process.once('SIGTERM', app.quit);
  process.once('SIGINT', app.quit);
  tui.start();
  timer = setInterval(() => app.tick(), 50);
  const seconds = Number(option('--duration', '0'));
  if (seconds > 0) deadline = setTimeout(app.quit, seconds * 1000);
  await client.run();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
}
