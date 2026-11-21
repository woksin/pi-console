import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

interface Lifetime { exit: Promise<number>; kill(): void }

function killGroup(child: ChildProcess): void {
  try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

/** Status files cover normal exits; parent-side completion also covers a killed shell that cannot write one. */
export function completion(child: ChildProcess, statusPath: string, cleanup: () => void): Lifetime {
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
