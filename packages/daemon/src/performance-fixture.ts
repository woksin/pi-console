// Shared test support for the warm-start and idle-memory integration specs (no real-data copies).
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Health, Snapshot } from '@pi-console/contract';
import { buildLargeTree, call } from '@pi-console/testkit';
import { loadToken } from './security/token.ts';

export const sessionCount = 100;
export const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
export function record(line: string): void {
  console.log(line);
  if (process.env.PI_CONSOLE_TIMING_FILE) appendFileSync(process.env.PI_CONSOLE_TIMING_FILE, `${line}\n`);
}

export interface PerformanceDaemon {
  port: number;
  startupMs: number;
  headers: { Authorization: string };
  close(): Promise<void>;
}

async function start(agentRoot: string, dataDir: string, t: TestContext): Promise<PerformanceDaemon> {
  const child = fork(new URL('./performance-worker.ts', import.meta.url), [agentRoot, dataDir], {
    execArgv: ['--experimental-ffi', '--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => { if (code === 0) resolve(); else reject(new Error(`Performance worker exited ${String(code)}`)); });
  });
  // Observe early failures even while the caller is measuring HTTP, then propagate them from close().
  void exited.catch(() => undefined);
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited.catch(() => undefined); });
  const ready = await Promise.race([workerReady(child), exited.then(() => { throw new Error('Worker exited before ready'); })]);
  return {
    ...ready, headers: { Authorization: `Bearer ${loadToken(dataDir)}` },
    async close() { child.send('stop'); await exited; },
  };
}

function workerReady(child: ChildProcess): Promise<{ port: number; startupMs: number }> {
  return new Promise(resolve => {
    child.once('message', (message: { port: number; startupMs: number }) => { resolve(message); });
  });
}

export async function health(daemon: PerformanceDaemon): Promise<Health> {
  const reply = await call(daemon.port, '/api/v1/health', { headers: daemon.headers });
  assert.equal(reply.status, 200);
  return reply.body as Health;
}

export async function drain(daemon: PerformanceDaemon): Promise<number> {
  const deadline = performance.now() + 120_000;
  let worst = 0;
  while (performance.now() < deadline) {
    const sent = performance.now();
    const state = await health(daemon);
    worst = Math.max(worst, performance.now() - sent);
    if (state.backfill.complete && state.projection.queueDepth === 0 && state.sources.every(source => source.lagBytes === 0)) return worst;
    await wait(50);
  }
  throw new Error('Synthetic daemon did not drain');
}

/** Populate checkpoints and projection snapshots in a separate cold process, then measure a fresh warm daemon. */
export async function warmFixture(t: TestContext): Promise<{ agentRoot: string; dataDir: string; start: () => Promise<PerformanceDaemon> }> {
  const base = mkdtempSync(join(tmpdir(), 'pi-console-performance-'));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  const tree = buildLargeTree(join(base, 'agent'), {
    ledgerRows: 50_000, statusFiles: 20_000, registryRows: 54_000, questionFiles: 1_500, eventRows: 200_000,
    sessionFiles: sessionCount, sessionBytes: 300 * 1024,
  });
  const dataDir = join(base, 'data');
  const cold = await start(tree.root, dataDir, t);
  await drain(cold);
  await cold.close();
  return { agentRoot: tree.root, dataDir, start: () => start(tree.root, dataDir, t) };
}

/** Read one complete SSE frame; the warm daemon must send an already populated initial snapshot. */
export async function snapshot(daemon: PerformanceDaemon): Promise<Snapshot> {
  const response = await fetch(`http://127.0.0.1:${String(daemon.port)}/api/v1/stream`, {
    headers: daemon.headers, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      assert.ok(!chunk.done, 'snapshot stream ended early');
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel(); }
  assert.match(text, /event: snapshot\n/);
  const data = text.split('\n').find(line => line.startsWith('data: '));
  assert.ok(data, 'snapshot data');
  return (JSON.parse(data.slice(6)) as { payload: Snapshot }).payload;
}
