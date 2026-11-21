import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import xterm from '@xterm/headless';

const { Terminal } = xterm;
export interface Pty { terminal: InstanceType<typeof Terminal>; recording: { at: number; data: string }[]; screen: () => string; send: (keys: string) => void; waitFor: (text: string | RegExp, timeoutMs?: number) => Promise<string>; exit: Promise<number>; kill: () => void }

/** `script` allocates the pty on both macOS and Linux; the flags differ. */
export function scriptArgs(platform: string, command: string): string[] {
  return platform === 'darwin' ? ['-q', '/dev/null', 'sh', '-c', command] : ['-qfec', command, '/dev/null'];
}

function recordOutput(terminal: Pty['terminal'], output: number, outputPath: string): { recording: Pty['recording']; stop: () => void } {
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
  return { recording, stop: () => { clearInterval(tail); } };
}

function killGroup(child: ChildProcess): void {
  try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

/** Status files cover normal exits; parent-side completion also covers a killed shell that cannot write one. */
function completion(child: ChildProcess, statusPath: string, cleanup: () => void): Pick<Pty, 'exit' | 'kill'> {
  let finish: (code: number) => void;
  let completed = false;
  const exit = new Promise<number>(resolveExit => {
    let drain: NodeJS.Timeout | undefined;
    const watch = setInterval(() => {
      if (!existsSync(statusPath)) return;
      clearInterval(watch);
      drain = setTimeout(() => { finish(Number(readFileSync(statusPath, 'utf8').trim())); }, 150);
    }, 25);
    finish = code => {
      if (completed) return;
      completed = true;
      clearInterval(watch); clearTimeout(drain);
      cleanup();
      resolveExit(code);
    };
    child.once('error', () => { finish(1); });
    child.once('exit', (code, signal) => { if (signal || !existsSync(statusPath)) finish(code ?? 1); });
  });
  return { exit, kill: () => {
    if (completed) return;
    try { killGroup(child); } finally { finish(137); }
  } };
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
  const { recording, stop } = recordOutput(terminal, output, outputPath);
  const lifetime = completion(child, statusPath, () => {
    stop(); closed = true; responses.dispose();
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
