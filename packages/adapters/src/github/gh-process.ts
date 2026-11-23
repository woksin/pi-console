import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

export type Spawn = (command: string, args: readonly string[], options: { stdio: ['ignore', 'pipe', 'pipe']; shell: false; env: NodeJS.ProcessEnv; windowsHide: true }) => ChildProcess;

export interface ProcessLimits {
  /** Whole-run timeout. */ timeoutMs: number;
  /** Time between SIGTERM and SIGKILL. */ graceMs: number;
  /** Extra wait after SIGKILL before the run is abandoned, so shutdown is bounded even by an unkillable child. */ killWaitMs: number;
  stdoutBytes: number; stderrBytes: number;
}
export const defaultLimits: ProcessLimits = { timeoutMs: 10_000, graceMs: 1_000, killWaitMs: 500, stdoutBytes: 32 * 1024, stderrBytes: 4 * 1024 };

export type ProcessEnd = 'exit' | 'timeout' | 'aborted' | 'overflow' | 'failed-to-start';
export interface ProcessResult { end: ProcessEnd; code: number | null; stdout: string; stderr: string }

/** Settings that make gh debug, prompt, page or colour; everything else (credentials, proxy) is gh's own business. */
const removed = ['GH_DEBUG', 'DEBUG', 'GH_PAGER', 'PAGER', 'GH_FORCE_TTY', 'CLICOLOR_FORCE', 'GH_HOST', 'GH_REPO', 'GH_PROMPT_DISABLED', 'NO_COLOR', 'GH_NO_UPDATE_NOTIFIER', 'GH_SPINNER_DISABLED', 'GH_NO_EXTENSION_UPDATE_NOTIFIER', 'GH_BROWSER'];
export function ghEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !removed.includes(name)));
  return { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', GH_PAGER: 'cat', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1' };
}

/** Appends a chunk without ever holding more than `limit` bytes; reports whether it was over. */
function collect(chunks: Buffer[], size: { value: number }, chunk: Buffer, limit: number): boolean {
  if (size.value + chunk.length > limit) return true;
  size.value += chunk.length;
  chunks.push(chunk);
  return false;
}

interface Capture { out: Buffer[]; err: Buffer[]; outSize: { value: number }; errSize: { value: number } }

function capture(child: ChildProcess, limits: ProcessLimits, onOverflow: () => void): Capture {
  const taken: Capture = { out: [], err: [], outSize: { value: 0 }, errSize: { value: 0 } };
  child.stdout?.on('data', (chunk: Buffer) => { if (collect(taken.out, taken.outSize, chunk, limits.stdoutBytes)) onOverflow(); });
  child.stderr?.on('data', (chunk: Buffer) => { if (collect(taken.err, taken.errSize, chunk, limits.stderrBytes)) onOverflow(); });
  return taken;
}

/** SIGTERM now, SIGKILL after the grace, then give up waiting after the kill wait. */
function escalate(child: ChildProcess, limits: ProcessLimits, timers: NodeJS.Timeout[], giveUp: () => void): void {
  const send = (name: NodeJS.Signals): void => { try { child.kill(name); } catch { /* Already gone. */ } };
  send('SIGTERM');
  timers.push(setTimeout(() => {
    send('SIGKILL');
    timers.push(setTimeout(giveUp, limits.killWaitMs));
  }, limits.graceMs));
}

function listen(signal: AbortSignal | undefined, onAbort: () => void): void {
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
}

function start(args: readonly string[], options: { spawn?: Spawn; env?: NodeJS.ProcessEnv }): ChildProcess | null {
  try {
    return (options.spawn ?? nodeSpawn)('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: options.env ?? ghEnvironment(), windowsHide: true });
  } catch { return null; }
}

/**
 * Runs one fixed `gh` argv: no shell, closed stdin, bounded output, hard timeout. A stop (abort or timeout) sends
 * SIGTERM, SIGKILL after the grace period, and settles at the latest `graceMs + killWaitMs` later even when the child
 * never exits. Only this one child is signalled. Output is returned to the caller for validation and is never logged here.
 */
export function runGh(args: readonly string[], options: { spawn?: Spawn; limits?: Partial<ProcessLimits>; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<ProcessResult> {
  const limits = { ...defaultLimits, ...options.limits };
  return new Promise(resolve => {
    const child = start(args, options);
    if (!child) { resolve({ end: 'failed-to-start', code: null, stdout: '', stderr: '' }); return; }
    const timers: NodeJS.Timeout[] = [];
    let settled = false, stopping: ProcessEnd | null = null;
    const taken = capture(child, limits, () => { stop('overflow'); });
    const finish = (end: ProcessEnd, code: number | null): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ end: stopping ?? end, code, stdout: Buffer.concat(taken.out).toString('utf8'), stderr: Buffer.concat(taken.err).toString('utf8') });
    };
    const stop = (reason: ProcessEnd): void => {
      if (settled || stopping) return;
      stopping = reason;
      escalate(child, limits, timers, () => { finish(reason, null); });
    };
    function onAbort(): void { stop('aborted'); }
    child.once('error', () => { finish('failed-to-start', null); });
    child.once('close', code => { finish('exit', code); });
    timers.push(setTimeout(() => { stop('timeout'); }, limits.timeoutMs));
    listen(options.signal, onAbort);
  });
}
