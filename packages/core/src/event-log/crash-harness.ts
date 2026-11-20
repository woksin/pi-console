// Kill/restart harness for the event log (ADR-0001 durability). The child appends batches with checkpoints; the parent
// SIGKILLs it at random points and checks that the log and the checkpoint always agree: nothing lost, nothing doubled.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SqliteEventLog } from './sqlite-event-log.ts';
import { testEvent } from '../testing/events.ts';

const source = 'session-jsonl';
const identity = 'crash:1';
const batchSize = 7;

/** Child side: resume from the checkpoint (re-appending a small overlap on purpose) and append up to `total`. */
export async function runCrashChild(path: string, total: number): Promise<void> {
  const log = new SqliteEventLog(path);
  const checkpoint = (await log.checkpoints(source)).at(0);
  const start = Math.max(0, (checkpoint?.offset ?? 0) - 3);
  for (let first = start; first < total; first += batchSize) {
    const last = Math.min(first + batchSize, total);
    const events = Array.from({ length: last - first }, (_, i) => testEvent(first + i, 'SessionHeartbeat', { sessionId: `s${first + i}`, status: 'ok' }));
    await log.append(events, [{ source, identity, generation: 0, offset: last, path: '/crash.jsonl', size: last, mtimeMs: 0 }]);
    process.stdout.write('.');
  }
  log.close();
}

export interface CrashState { events: number; distinct: number; checkpoint: number; maxOffset: number }

/** What a fresh process sees in the log after a crash. */
export async function inspectCrashLog(path: string): Promise<CrashState> {
  const log = new SqliteEventLog(path);
  const ids = new Set<string>();
  let events = 0;
  for await (const event of log.readFrom(0)) {
    events++;
    ids.add(event.id);
  }
  const checkpoint = (await log.checkpoints(source)).at(0);
  const maxOffset = log.lastSeq() === 0 ? 0 : Math.max(...[...ids].map(id => parseInt(id.slice(-12), 16) + 1));
  log.close();
  return { events, distinct: ids.size, checkpoint: checkpoint?.offset ?? 0, maxOffset };
}

const childScript = fileURLToPath(new URL('./crash-child.ts', import.meta.url));

/**
 * Starts the child and SIGKILLs it once it reports `killAfterBatches` committed batches, while it keeps appending
 * (or lets it finish when undefined). Counting batches, not milliseconds, keeps the kill mid-stream on any machine.
 */
export function crashChild(path: string, total: number, killAfterBatches?: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childScript, path, String(total)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let batches = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      batches += chunk.length;
      if (killAfterBatches !== undefined && batches >= killAfterBatches) child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('exit', code => { resolve(code); });
  });
}
