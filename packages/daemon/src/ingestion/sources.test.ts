import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope } from '@pi-console/contract';
import { buildAgentTree, call, type AgentTree } from '@pi-console/testkit';
import { loadConfig, type ConfigOverrides } from '../config.ts';
import { startDaemon, type RunningDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';
import { SourceIngestion } from './source-ingestion.ts';
import { SourceSet } from './sources.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Running { daemon: RunningDaemon; directory: string; tree: AgentTree; get(path: string): Promise<Json>; stop(): Promise<void> }

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sourceIds = ['context-budget', 'lane-messages', 'lane-heartbeats', 'question-store', 'issue-work', 'phase-ledger'];

function fixture(t: TestContext, secrets = false): { tree: AgentTree; directory: string } {
  const base = mkdtempSync(join(tmpdir(), 'pi-console-sources-'));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  const directory = join(base, 'data');
  mkdirSync(directory, { mode: 0o700 });
  return { tree: buildAgentTree(join(base, 'agent'), { includeSecrets: secrets }), directory };
}

async function launch(t: TestContext, tree: AgentTree, directory: string, overrides: ConfigOverrides = {}): Promise<Running> {
  const config = loadConfig(directory, { port: 0, agentRoot: tree.root, orchRoot: tree.orchRoot, pollMs: 20, sourcePollMs: 20, ...overrides });
  const daemon = await startDaemon(config);
  const token = loadToken(directory);
  const get = async (path: string) => (await call(daemon.port, `/api/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } })).body;
  const stop = () => daemon.close();
  for (let i = 0; i < 300 && !(await get('health')).backfill.complete; i++) await wait(10);
  const running = { daemon, directory, tree, get, stop };
  t.after(async () => { await stop().catch(() => undefined); });
  return running;
}

const events = async (daemon: RunningDaemon): Promise<EventEnvelope[]> => {
  const found: EventEnvelope[] = [];
  for await (const event of daemon.log.readFrom(0)) found.push(event);
  return found;
};

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 300 && !done(value); i++) { await wait(10); value = await read(); }
  return value;
}

test('sessions still arrive and every other source reaches its API surface from the fake agent tree', async t => {
  const { tree, directory } = fixture(t);
  const running = await launch(t, tree, directory);
  assert.ok((await running.get('sessions')).items.length >= 1, 'session ingestion still delivers');
  const questions = (await running.get('questions')).items;
  assert.deepEqual(questions.map((q: { id: string }) => q.id), ['q-1']);
  const messages = (await running.get('messages')).items;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'msg-1');
  assert.ok((await running.get('needs-you')).items.some((item: { text?: string }) => String(item.text).includes('retry limit')));
  const jobs = (await running.get('jobs')).items;
  assert.ok(jobs.some((job: { kind: string; name: string }) => job.kind === 'phase' && job.name === 'unit checks'), 'phase facts reach /jobs');
  const all = await events(running.daemon);
  for (const type of ['ResetOccurred', 'MessageSent', 'SessionHeartbeat', 'IssueStatusChanged', 'QuestionAsked', 'PhaseFinished']) {
    assert.ok(all.some(event => event.type === type), type);
  }
  assert.deepEqual(all.filter(event => event.type === 'SourceSchemaUnknown' && event.source !== 'session-jsonl').map(event => [event.source, JSON.stringify(event.payload)]), [], 'a well-formed tree raises no schema warnings from the new sources');
});

test('question text is redacted before it reaches the API', async t => {
  const { tree, directory } = fixture(t, true);
  const running = await launch(t, tree, directory);
  const { secretsIn } = await import('@pi-console/testkit');
  assert.deepEqual(secretsIn(JSON.stringify(await running.get('questions'))), []);
  assert.deepEqual(secretsIn(JSON.stringify(await events(running.daemon))), []);
});

test('health lists every enabled source with counters and settings lists all, neither revealing a path', async t => {
  const { tree, directory } = fixture(t);
  const running = await launch(t, tree, directory, { sources: { 'phase-ledger': false } });
  const health = await running.get('health');
  const byId = new Map(health.sources.map((source: { source: string }) => [source.source, source]));
  assert.equal(health.status, 'ok');
  assert.equal(byId.has('phase-ledger'), false);
  for (const id of ['session-jsonl', ...sourceIds.filter(id => id !== 'phase-ledger')]) {
    const source = byId.get(id) as { files: number; lagBytes: number; lastPollAt: string | null; errors: number };
    assert.ok(source, id);
    assert.ok(source.files > 0 || id === 'lane-heartbeats' || id === 'lane-messages', `${id} files`);
    assert.equal(source.lagBytes, 0, id);
    assert.equal(typeof source.lastPollAt, 'string', id);
    assert.equal(source.errors, 0, id);
  }
  assert.ok((byId.get('lane-messages') as { files: number }).files > 0, 'lane-messages reads the lane registry and the orch inbox');
  const settings = await running.get('settings');
  assert.deepEqual(settings.sources.map((source: { source: string }) => source.source).sort(), ['session-jsonl', ...sourceIds].sort());
  assert.equal(settings.sources.find((source: { source: string }) => source.source === 'phase-ledger').enabled, false);
  for (const text of [JSON.stringify(health), JSON.stringify(settings)]) {
    assert.ok(!text.includes(tree.root) && !text.includes(directory), 'no path in health or settings');
  }
});

const changes: [string, (tree: AgentTree) => void][] = [
  ['question-store', tree => {
    const next = { v: 1, id: 'q-1', rev: 2, type: 'decision', priority: 'high', blocking: 'awaiting', text: 'Edited?', history: [{ seq: 1, type: 'created', ts: '2026-11-20T09:01:10.000Z' }, { seq: 2, type: 'edited', ts: '2026-11-20T09:02:00.000Z' }] };
    writeFileSync(join(tree.root, 'user-questions/items/q-1/r00000002.json'), JSON.stringify(next) + '\n');
  }],
  ['lane-messages', tree => {
    writeFileSync(join(tree.orchRoot, 'inbox/L192/20261120T090200Z-L0-c3d4.json'), JSON.stringify({ id: 'msg-2', from: 'L0', to: 'L192', body: 'Second.', createdAt: '2026-11-20T09:02:00.000Z' }) + '\n');
  }],
  ['lane-heartbeats', tree => {
    writeFileSync(join(tree.orchRoot, 'heartbeats/session-a.json'), JSON.stringify({ sessionId: 'session-a', status: 'active', at: '2026-11-20T09:05:00.000Z' }) + '\n');
  }],
  ['issue-work', tree => {
    appendFileSync(join(tree.root, 'issue-work/registry.jsonl'), JSON.stringify({ repo: 'example/console', issue: 42, sessionId: 'session-a', state: 'in-review', ts: '2026-11-20T09:06:00.000Z' }) + '\n');
  }],
  ['context-budget', tree => {
    appendFileSync(join(tree.root, 'context-budget/events.jsonl'), JSON.stringify({ at: '2026-11-20T09:07:00.000Z', event: 'handoff_committed', sessionId: 'session-a', path: 'handoffs/second.md' }) + '\n');
  }],
  ['phase-ledger', tree => {
    appendFileSync(join(tree.root, 'pi-phase/state/ledger/2026-11-20.jsonl'), JSON.stringify({ v: 1, argvHash: 'hash-two', label: 'lint', queuedAt: '2026-11-20T09:08:00.000Z', startedAt: '2026-11-20T09:08:01.000Z', endedAt: '2026-11-20T09:08:09.000Z', outcome: 'passed', exit: 0 }) + '\n');
  }],
];
const expectedNew: Record<string, number> = { 'question-store': 1, 'lane-messages': 1, 'lane-heartbeats': 1, 'issue-work': 1, 'context-budget': 1, 'phase-ledger': 3 };

for (const [source, change] of changes) {
  test(`${source}: a restart appends nothing old; a later change appends exactly the new events`, async t => {
    const { tree, directory } = fixture(t);
    const first = await launch(t, tree, directory);
    const settled = (await events(first.daemon)).length;
    assert.ok(settled > 0);
    await first.stop();
    const second = await launch(t, tree, directory);
    assert.equal((await events(second.daemon)).length, settled, 'no duplicates after restart');
    change(tree);
    const after = await until(async () => events(second.daemon), found => found.length > settled);
    await wait(100);
    const final = await events(second.daemon);
    assert.equal(final.length - settled, expectedNew[source], `${source} new events (saw ${after.length - settled} early)`);
    assert.ok(final.slice(settled).every(event => event.source === source), 'only the changed source appended');
  });
}

test('a malformed or unreadable file in one source does not stop the others', async t => {
  const { tree, directory } = fixture(t);
  writeFileSync(join(tree.root, 'user-questions/items/q-1/bad.json'), '{');
  const blocked = join(tree.root, 'issue-work/registry.jsonl');
  const unreadable = process.platform !== 'win32' && process.getuid?.() !== 0;
  if (unreadable) chmodSync(blocked, 0o000);
  t.after(() => { try { if (unreadable) chmodSync(blocked, 0o600); } catch { /* already removed */ } });
  const running = await launch(t, tree, directory);
  const health = await running.get('health');
  const source = (id: string) => health.sources.find((item: { source: string }) => item.source === id);
  assert.equal((await running.get('questions')).items.length, 1);
  assert.equal((await running.get('messages')).items.length, 1);
  assert.ok((await running.get('sessions')).items.length >= 1, 'session ingestion still delivers');
  assert.ok((await events(running.daemon)).some(event => event.type === 'SourceSchemaUnknown' && event.source === 'question-store'), 'bad question file is a body-free warning');
  if (unreadable) assert.ok(source('issue-work').errors > 0, 'unreadable file counted');
  assert.equal(source('lane-messages').errors, 0);
});

test('a source worker that cannot be built does not stop the others', async () => {
  const appended: string[] = [];
  const ok = { poll: () => { appended.push('ok'); return Promise.resolve(); }, close: () => undefined };
  const errors: unknown[] = [];
  const set = new SourceSet([
    { id: 'issue-work', worker: () => { throw new Error('boom'); } },
    { id: 'phase-ledger', worker: () => ok },
  ], { intervalMs: 10, onError: (_source, error) => { errors.push(error); } });
  set.start();
  await until(async () => appended.length, count => count > 2);
  await set.stop();
  assert.ok(appended.length > 2, 'the healthy source kept polling');
  assert.ok(errors.length > 0, 'the failing source reported errors and backed off');
  assert.equal(set.statuses().length, 2);
  assert.equal(set.statuses()[0].lastPollAt, null);
});

test('SourceIngestion counts per-file failures and keeps polling the other files', async t => {
  const { tree } = fixture(t);
  const directory = join(tree.root, 'user-questions/items');
  writeFileSync(join(directory, 'q-1', 'zz.json'), '{');
  let attempts = 0;
  const log = {
    append: () => { attempts++; return Promise.reject(new Error('disk')); }, checkpoints: () => Promise.resolve([]),
    readFrom: () => (async function* () { /* empty */ })(), subscribe: () => () => undefined,
  };
  const ingestion = new SourceIngestion(log, { id: 'question-store', feeds: [{ mapper: () => [], kind: 'snapshot', directories: [directory], extension: '.json' }], backfillWindowDays: 14 });
  await ingestion.poll();
  assert.equal(attempts, 2, 'the second file was still attempted');
  assert.equal(ingestion.status.errors, 2);
  assert.equal(typeof ingestion.status.lastPollAt, 'string');
  ingestion.close();
});

test('symlinked source files and roots are not ingested', async t => {
  const { tree, directory } = fixture(t);
  const outside = join(tree.root, '..', 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'm.json'), JSON.stringify({ id: 'msg-x', from: 'A', to: 'B', body: 'leak', createdAt: '2026-11-20T09:00:00.000Z' }));
  symlinkSync(join(outside, 'm.json'), join(tree.orchRoot, 'inbox/L192/link.json'));
  rmSync(join(tree.root, 'user-questions/items/q-1/r00000001.json'));
  symlinkSync(outside, join(tree.root, 'issue-work-link'));
  rmSync(join(tree.root, 'issue-work'), { recursive: true });
  symlinkSync(outside, join(tree.root, 'issue-work'));
  const running = await launch(t, tree, directory);
  assert.deepEqual((await running.get('messages')).items.map((message: { id: string }) => message.id), ['msg-1']);
  assert.equal((await running.get('questions')).items.length, 0);
  assert.ok(!(await events(running.daemon)).some(event => event.type === 'IssueStatusChanged'));
});

test('deny-listed names are never read, even when the agent root points at them', async t => {
  const { tree, directory } = fixture(t);
  const denied = join(tree.root, '..', 'credentials');
  mkdirSync(join(denied, 'user-questions/items/q-9'), { recursive: true });
  writeFileSync(join(denied, 'user-questions/items/q-9/r1.json'), JSON.stringify({ v: 1, id: 'q-9', rev: 1, type: 'question', priority: 'normal', blocking: '', text: 'secret?', history: [{ seq: 1, type: 'created', ts: '2026-11-20T09:00:00.000Z' }] }));
  const running = await launch(t, tree, directory, { agentRoot: denied, sessionRoots: [] });
  assert.equal((await running.get('questions')).items.length, 0);
  assert.equal((await events(running.daemon)).filter(event => event.subject.startsWith('question:')).length, 0);
});
