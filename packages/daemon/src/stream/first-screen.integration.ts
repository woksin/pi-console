// Integration tier (`npm run gate:integration -- --scope daemon`): time to a usable first screen on a large state
// (50,000 jobs by default, synthetic: no copy of real data). The web `ConsoleStore` and the TUI `Store` + `DaemonClient`
// run against the real daemon over real HTTP, as the clients do; each must show sessions in < 3 s and the snapshot
// frame must stay far below the 1 MiB slow-client cap. Numbers go to PI_CONSOLE_TIMING_FILE when set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SqliteEventLog } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { defaultConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';

const jobs = Number(process.env.PI_CONSOLE_FIRST_SCREEN_JOBS ?? 50_000);
const sessionCount = 300;
const budgetMs = 3000;
const root = new URL('../../../../', import.meta.url);
// The clients live in other packages; they are loaded by path so this package's build does not depend on them.
interface Shown { sessions: unknown[]; jobs: unknown[]; totals: { jobs: number } | null }
interface WebStore { start: () => void; stop: () => void; getState: () => Shown & { connection: string } }
interface TuiStore { apply: (event: unknown) => void; flush: () => void; getSnapshot: () => Shown & { loaded: boolean } }
interface TuiClient { stream: (handlers: { onEvent: (event: unknown) => void; onState: () => void }) => Promise<void>; stop: () => void }
const load = async <T>(path: string): Promise<T> => await import(pathToFileURL(new URL(path, root).pathname).href) as T;
const record = (line: string): void => { console.log(line); if (process.env.PI_CONSOLE_TIMING_FILE) appendFileSync(process.env.PI_CONSOLE_TIMING_FILE, `${line}\n`); };

function events() {
  const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();
  const all = [];
  let n = 0;
  for (let s = 0; s < sessionCount; s++) all.push(testEvent(n++, 'SessionStarted', { sessionId: `s${s}`, cwd: `/repo/${s % 5}`, model: 'm1', role: 'main', parentSessionId: null }, { occurredAt: at(n) }));
  for (let j = 0; j < jobs; j++) {
    all.push(testEvent(n++, 'JobStarted', { jobId: `j${j}`, sessionId: `s${j % sessionCount}`, name: 'build', kind: 'job' }, { occurredAt: at(n) }));
    if (j % 1000 !== 0) all.push(testEvent(n++, 'JobFinished', { jobId: `j${j}`, status: 'done', exitCode: 0 }, { occurredAt: at(n) }));
  }
  for (let m = 0; m < 2000; m++) all.push(testEvent(n++, 'MessageSent', { messageId: `m${m}`, from: 'lane-a', to: 'lane-b', excerpt: `hello ${m}`, withheld: false }, { occurredAt: at(n) }));
  return all;
}

test(`first screen on ${jobs} jobs: web and TUI show sessions in under ${budgetMs} ms from a bounded snapshot`, { timeout: 600_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-first-screen-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const log = new SqliteEventLog(join(directory, 'console.db'));
  const all = events();
  for (let start = 0; start < all.length; start += 5_000) await log.append(all.slice(start, start + 5_000));
  log.close();
  const processStart = performance.now();
  const daemon = await startDaemon({ ...defaultConfig(directory), port: 0, sessionRoots: [], ingest: false });
  const listening = performance.now() - processStart;
  t.after(async () => { await daemon.close(); });
  const token = loadToken(directory);
  const base = `http://127.0.0.1:${String(daemon.port)}`;

  const raw = await fetch(`${base}/api/v1/stream`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } });
  const reader = (raw.body as ReadableStream<Uint8Array>).getReader();
  let text = '';
  while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  const frameBytes = Buffer.byteLength(text);
  assert.ok(frameBytes < 512 * 1024, `snapshot frame ${frameBytes} bytes`);

  const { ConsoleStore } = await load<{ ConsoleStore: new (api: unknown, clock: unknown) => WebStore }>('packages/web/src/client/store.ts');
  const { createApi } = await load<{ createApi: (token: string, base: string) => unknown }>('packages/web/src/client/api.ts');
  const web = new ConsoleStore(createApi(token, base), {
    now: () => Date.now(), setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms) as unknown as number, clearTimeout: (id: number) => { clearTimeout(id); },
  });
  const webStart = performance.now();
  web.start();
  while (web.getState().connection !== 'live' || web.getState().sessions.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
  const webMs = performance.now() - webStart;
  const webState = web.getState();
  web.stop();

  const { Store } = await load<{ Store: new () => TuiStore }>('packages/tui/src/store/store.ts');
  const { DaemonClient } = await load<{ DaemonClient: new (credentials: { baseUrl: string; token: string; tokenSource: string }) => TuiClient }>('packages/tui/src/api/client.ts');
  const tui = new Store();
  const client = new DaemonClient({ baseUrl: base, token, tokenSource: 'test' });
  const tuiStart = performance.now();
  void client.stream({ onEvent: event => { tui.apply(event); }, onState: () => undefined });
  while (!tui.getSnapshot().loaded) await new Promise(resolve => setTimeout(resolve, 5));
  tui.flush();
  const tuiMs = performance.now() - tuiStart;
  const tuiData = tui.getSnapshot();
  client.stop();

  record(`first-screen: ${jobs} jobs; daemon listening after ${listening.toFixed(0)} ms (cold replay of ${all.length} events); snapshot frame ${frameBytes} bytes; web ${webMs.toFixed(0)} ms (${webState.sessions.length} sessions, ${webState.jobs.length}/${webState.totals?.jobs} jobs); TUI ${tuiMs.toFixed(0)} ms (${tuiData.sessions.length} sessions, ${tuiData.jobs.length}/${tuiData.totals?.jobs} jobs); RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
  assert.equal(webState.totals?.jobs, jobs);
  assert.equal(tuiData.totals?.jobs, jobs);
  assert.ok(webState.jobs.length < jobs && tuiData.jobs.length < jobs);
  assert.ok(webMs < budgetMs, `web first screen ${webMs} ms`);
  assert.ok(tuiMs < budgetMs, `TUI first screen ${tuiMs} ms`);
});
