import { execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import xterm from '@xterm/headless';
import { completion } from './pty-lifetime.ts';

const { Terminal } = xterm;
export interface Pty { terminal: InstanceType<typeof Terminal>; recording: { at: number; data: string }[]; screen: () => string; send: (keys: string) => void; waitFor: (text: string | RegExp, timeoutMs?: number) => Promise<string>; exit: Promise<number>; kill: () => void }

/** `script` allocates the pty on both macOS and Linux; the flags differ. */
export function scriptArgs(platform: string, command: string): string[] {
  return platform === 'darwin' ? ['-q', '/dev/null', 'sh', '-c', command] : ['-qfec', command, '/dev/null'];
}

function recordOutput(terminal: Pty['terminal'], output: number, outputPath: string): { recording: Pty['recording']; timer: NodeJS.Timeout } {
  const recording: Pty['recording'] = [];
  const started = Date.now();
  let offset = 0;
  const tail = setInterval(() => {
    const size = statSync(outputPath).size;
    if (size <= offset) return;
    const chunk = Buffer.alloc(size - offset);
    readSync(output, chunk, 0, chunk.length, offset);
    offset = size;
    terminal.write(chunk);
    recording.push({ at: Date.now() - started, data: chunk.toString('utf8') });
  }, 25);
  return { recording, timer: tail };
}

/**
 * Runs a command on a real pty and renders its output into an xterm emulator so specs assert on the visible screen.
 * macOS `script` rejects the sockets node uses for pipes, so a shell builds a real pipe from a FIFO (input) and the
 * output goes to a file that is tailed.
 */
export function startPty(command: string, options: { cols: number; rows: number; env: NodeJS.ProcessEnv }): Pty {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-pty-'));
  const fifo = join(directory, 'input');
  execFileSync('mkfifo', [fifo]);
  const input = openSync(fifo, 'r+');
  const outputPath = join(directory, 'output');
  const output = openSync(outputPath, 'w+');
  const statusPath = join(directory, 'status');
  const terminal = new Terminal({ cols: options.cols, rows: options.rows, allowProposedApi: true });
  const full = `stty cols ${String(options.cols)} rows ${String(options.rows)}; ${command}`;
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const script = ['script', ...scriptArgs(process.platform, full)].map(quote).join(' ');
  const child = spawn('sh', ['-c', `cat ${quote(fifo)} | { ${script} > ${quote(outputPath)} 2>&1; echo $? > ${quote(statusPath)}; }`], { env: { ...options.env, TERM: 'xterm-256color' }, stdio: 'ignore', detached: true });
  let closed = false;
  const write = (text: string) => { if (!closed) writeSync(input, text); };
  /** The emulator answers the terminal queries OpenTUI sends at startup (cursor position, device attributes). */
  const responses = terminal.onData(write);
  const { recording, timer } = recordOutput(terminal, output, outputPath);
  const lifetime = completion(child, statusPath, () => {
    clearInterval(timer); closed = true; responses.dispose();
    closeSync(input); closeSync(output); rmSync(directory, { recursive: true, force: true });
  });
  const screen = () => Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n');
  const waitFor = async (text: string | RegExp, timeoutMs = 15000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = screen();
      if (typeof text === 'string' ? current.includes(text) : text.test(current)) return current;
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    throw new Error(`Timed out waiting for ${String(text)}. Screen:\n${screen()}`);
  };
  return { terminal, recording, screen, send: write, waitFor, ...lifetime };
}
