import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppendResult, EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';
import type { Mapper } from '@pi-console/adapters';
import { buildAgentTree } from '@pi-console/testkit';
import { SourceIngestion } from './source-ingestion.ts';
import { SourceSet } from './sources.ts';
import { sourceTable, type SourceSpec } from './source-table.ts';
import type { SourceId } from './source-ids.ts';

const day = 86_400_000;
const now = new Date('2026-11-20T12:00:00.000Z');
const since = now.getTime() - 14 * day;
const iso = (ms: number) => new Date(ms).toISOString();
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** In-memory log with the real idempotency and checkpoint behaviour, counting reads of the checkpoint table. */
class MemoryLog implements EventLog {
  events: NewEvent[] = [];
  saved = new Map<string, SourceCheckpoint>();
  checkpointReads = 0;
  delayMs = 0;
  readonly #keys = new Set<string>();

  async append(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    if (this.delayMs > 0) await wait(this.delayMs);
    let appended = 0;
    for (const event of events) if (!this.#keys.has(event.idempotencyKey)) { this.#keys.add(event.idempotencyKey); this.events.push(event); appended++; }
    for (const checkpoint of checkpoints) this.saved.set(`${checkpoint.source}|${checkpoint.identity}`, checkpoint);
    return { appended, duplicates: events.length - appended, lastSeq: this.events.length };
  }

  checkpoints(source: string): Promise<SourceCheckpoint[]> {
    this.checkpointReads++;
    return Promise.resolve([...this.saved.values()].filter(checkpoint => checkpoint.source === source));
  }

  readFrom(): AsyncIterable<never> { return (async function* () { /* empty */ })(); }
  subscribe(): () => void { return () => undefined; }
}

function agentRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-volume-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  return root;
}

const restore = (file: string) => { try { chmodSync(file, 0o600); } catch { /* removed with the tree */ } };
const put = (file: string, content: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, content); };
const spec = (root: string, id: SourceId, mapper?: Mapper): SourceSpec => {
  const found = sourceTable({ agentRoot: root, orchRoot: join(root, 'orch') }).find(item => item.id === id)!;
  return mapper ? { ...found, feeds: found.feeds.map(feed => ({ ...feed, mapper })) } : found;
};
const counting = (mapper: Mapper): { mapper: Mapper; calls: () => number } => {
  let calls = 0;
  return { mapper: record => { calls++; return mapper(record); }, calls: () => calls };
};
const ingestion = (log: EventLog, source: SourceSpec) => new SourceIngestion(log, { id: source.id, feeds: source.feeds, backfillWindowDays: 14, now: () => now });
const phaseRow = (queued: number, hash: string) => ({ v: 1, argvHash: hash, label: 'lint', queuedAt: iso(queued), startedAt: iso(queued + 1_000), endedAt: iso(queued + 2_000), outcome: 'passed', exit: 0 });
const issueRow = (ts: number, issue: number) => ({ repo: 'example/console', issue, sessionId: 's', state: 'in-progress', ts: iso(ts) });

test('ledger: old rows in a fresh-mtime file emit nothing, and day files older than the window are never opened', async t => {
  const root = agentRoot(t);
  const ledger = join(root, 'pi-phase/state/ledger');
  const today = iso(now.getTime()).slice(0, 10);
  put(join(ledger, `${today}.jsonl`), jsonl([phaseRow(now.getTime() - 30 * day, 'old'), phaseRow(now.getTime() - 3_600_000, 'fresh')]));
  const old = join(ledger, `${iso(now.getTime() - 30 * day).slice(0, 10)}.jsonl`);
  put(old, jsonl([phaseRow(now.getTime() - 30 * day, 'older')]));
  chmodSync(old, 0o000);
  t.after(() => { restore(old); });
  const log = new MemoryLog();
  const worker = ingestion(log, spec(root, 'phase-ledger'));
  await worker.poll();
  worker.close();
  assert.deepEqual(log.events.map(event => event.type).sort(), ['PhaseFinished', 'PhaseQueued', 'PhaseStarted']);
  assert.ok(log.events.every(event => event.subject.includes('fresh')), 'only the in-window row');
  assert.equal(worker.status.errors, 0, 'the out-of-window day file was not opened');
  assert.equal(worker.status.files, 1);
});

test('registry: a fresh checkpoint starts at the first in-window row (boundary inclusive) and a truncated file resets', async t => {
  const root = agentRoot(t);
  const file = join(root, 'issue-work/registry.jsonl');
  const rows = Array.from({ length: 3_000 }, (_, i) => issueRow(since - 20 * day + Math.floor(i * (34 * day) / 3_000), i));
  rows.push(issueRow(since, 9_001));
  rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  put(file, jsonl(rows));
  const expected = rows.filter(row => Date.parse(row.ts) >= since).length;
  assert.ok(expected > 0 && expected < rows.length / 2);
  const probe = counting(spec(root, 'issue-work').feeds[0].mapper);
  const log = new MemoryLog();
  const worker = ingestion(log, spec(root, 'issue-work', probe.mapper));
  await worker.poll();
  assert.equal(probe.calls(), expected, 'rows before the window were never parsed');
  assert.equal(log.events.length, expected);
  assert.ok(log.events.some(event => (event.payload as { issue: string }).issue === 'example/console#9001'), 'boundary row included');
  const [checkpoint] = [...log.saved.values()];
  assert.equal(checkpoint.offset, checkpoint.size);
  put(file, jsonl([issueRow(since - day, 1), issueRow(now.getTime() - 1_000, 2), issueRow(now.getTime() - 500, 3)]));
  await worker.poll();
  worker.close();
  assert.equal(log.events.length, expected + 2, 'after truncation only in-window rows of the new epoch are read');
});

test('context-budget: status files and turns files produce no events, warnings or checkpoints; handoffs still reset, other lines are not parsed', async t => {
  const root = agentRoot(t);
  const context = join(root, 'context-budget');
  const at = iso(now.getTime() - 3_600_000);
  put(join(context, 'status/a.json'), JSON.stringify({ at, cursor: 1 }) + '\n');
  put(join(context, 'turns.jsonl'), jsonl([{ at, event: 'turn', sessionId: 's' }]));
  put(join(context, 'events.jsonl'), jsonl([
    { at, event: 'turn', sessionId: 's' }, { at, event: 'soft_crossing', sessionId: 's' },
    { at, event: 'handoff_committed', sessionId: 's', path: 'h.md' },
  ]));
  const probe = counting(spec(root, 'context-budget').feeds[0].mapper);
  const log = new MemoryLog();
  const worker = ingestion(log, spec(root, 'context-budget', probe.mapper));
  await worker.poll();
  worker.close();
  assert.deepEqual(log.events.map(event => event.type), ['ResetOccurred']);
  assert.equal(probe.calls(), 1, 'only the handoff line reached the mapper');
  assert.deepEqual([...log.saved.values()].map(checkpoint => checkpoint.path.endsWith('events.jsonl')), [true]);
  assert.equal(worker.status.files, 1);
});

test('issue-work reads only registry.jsonl', async t => {
  const root = agentRoot(t);
  put(join(root, 'issue-work/registry.jsonl'), jsonl([issueRow(now.getTime() - 1_000, 1)]));
  put(join(root, 'issue-work/seen/x.jsonl'), jsonl([issueRow(now.getTime() - 1_000, 2)]));
  put(join(root, 'issue-work/registry.jsonl.bak-1'), jsonl([issueRow(now.getTime() - 1_000, 3)]));
  const log = new MemoryLog();
  const worker = ingestion(log, spec(root, 'issue-work'));
  await worker.poll();
  worker.close();
  assert.deepEqual(log.events.map(event => (event.payload as { issue: string }).issue), ['example/console#1']);
  assert.equal(worker.status.files, 1);
});

test('snapshots: an unchanged file is not re-read on the next poll, a changed one is', async t => {
  const tree = buildAgentTree(agentRoot(t));
  const file = join(tree.root, 'user-questions/items/q-1/r00000001.json');
  const log = new MemoryLog();
  const worker = ingestion(log, spec(tree.root, 'question-store'));
  await worker.poll();
  const first = log.events.length;
  assert.ok(first > 0);
  chmodSync(file, 0o000);
  t.after(() => { restore(file); });
  await worker.poll();
  assert.equal(worker.status.errors, 0, 'same mtime and size: not opened');
  chmodSync(file, 0o600);
  const edited = { v: 1, id: 'q-1', rev: 1, type: 'decision', priority: 'high', blocking: 'awaiting the retry limit', text: 'Edited, and longer than before?', history: [{ seq: 1, type: 'created', ts: '2026-11-20T09:01:10.000Z' }] };
  writeFileSync(file, JSON.stringify(edited) + '\n');
  await worker.poll();
  worker.close();
  assert.ok(log.events.length > first, 'changed content is read');
});

test('checkpoints are read from the log once per source start and stay correct across appends and restarts', async t => {
  const tree = buildAgentTree(agentRoot(t));
  const log = new MemoryLog();
  const source = spec(tree.root, 'question-store');
  const worker = ingestion(log, source);
  await worker.poll();
  const first = log.events.length;
  put(join(tree.root, 'user-questions/items/q-2/r00000001.json'), JSON.stringify({ v: 1, id: 'q-2', rev: 1, type: 'question', priority: 'normal', blocking: '', text: 'Second?', history: [{ seq: 1, type: 'created', ts: '2026-11-20T09:03:00.000Z' }] }) + '\n');
  await worker.poll();
  worker.close();
  assert.equal(log.checkpointReads, 1);
  assert.ok(log.events.length > first);
  const total = log.events.length;
  const restarted = ingestion(log, source);
  await restarted.poll();
  restarted.close();
  assert.equal(log.events.length, total, 'no duplicates after a restart');
  assert.equal(log.checkpointReads, 2);
});

test('the table lists question-store first and phase-ledger last, smallest first', () => {
  const ids = sourceTable({ agentRoot: '/a', orchRoot: '/o' }).map(source => source.id);
  assert.deepEqual(ids, ['question-store', 'lane-messages', 'lane-heartbeats', 'context-budget', 'issue-work', 'phase-ledger']);
});

test('sources do not start before the gate opens and each starts only after the previous one settled', async () => {
  const order: string[] = [];
  const entry = (id: SourceId, pollMs: number) => ({ id, worker: () => ({ poll: async () => { order.push(`${id}:start`); await wait(pollMs); order.push(`${id}:end`); }, close: () => undefined }) });
  const set = new SourceSet([entry('question-store', 40), entry('context-budget', 10)], { intervalMs: 20 });
  let open = false;
  set.start(() => open);
  await wait(80);
  assert.deepEqual(order, [], 'nothing before the gate');
  assert.equal(set.backfillComplete, false);
  open = true;
  await wait(250);
  assert.deepEqual(order.slice(0, 4), ['question-store:start', 'question-store:end', 'context-budget:start', 'context-budget:end']);
  assert.equal(set.backfillComplete, true);
  await set.stop();
});

test('stopping during a long backfill returns within a second', async t => {
  const tree = buildAgentTree(agentRoot(t));
  for (let i = 0; i < 300; i++) put(join(tree.root, 'user-questions/items', `bulk-${i}`, 'r00000001.json'), JSON.stringify({ v: 1, id: `bulk-${i}`, rev: 1, type: 'question', priority: 'normal', blocking: '', text: 'Bulk?', history: [{ seq: 1, type: 'created', ts: '2026-11-20T09:03:00.000Z' }] }) + '\n');
  const log = new MemoryLog();
  log.delayMs = 30;
  const source = spec(tree.root, 'question-store');
  const set = new SourceSet([{ id: source.id, worker: () => ingestion(log, source) }], { intervalMs: 20 });
  set.start();
  await wait(150);
  const began = performance.now();
  await set.stop();
  assert.ok(performance.now() - began < 1_000, `stop took ${performance.now() - began} ms`);
});
