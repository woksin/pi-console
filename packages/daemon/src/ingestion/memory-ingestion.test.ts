import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppendResult, EventLog, NewEvent, SourceCheckpoint } from '@pi-console/contract';
import { crc32 } from '@pi-console/adapters';
import { loadConfig } from '../config.ts';
import { SourceIngestion } from './source-ingestion.ts';
import { sourceTable } from './source-table.ts';

const day = 86_400_000;
const now = new Date('2026-11-20T12:00:00.000Z');
const at = '2026-07-01T10:00:00Z';

class Log implements EventLog {
  events: NewEvent[] = [];
  saved = new Map<string, SourceCheckpoint>();
  async append(events: readonly NewEvent[], checkpoints: readonly SourceCheckpoint[] = []): Promise<AppendResult> {
    this.events.push(...events);
    for (const checkpoint of checkpoints) this.saved.set(`${checkpoint.source}|${checkpoint.identity}`, checkpoint);
    return { appended: events.length, duplicates: 0, lastSeq: this.events.length };
  }
  checkpoints(source: string): Promise<SourceCheckpoint[]> { return Promise.resolve([...this.saved.values()].filter(checkpoint => checkpoint.source === source)); }
  readFrom(): AsyncIterable<never> { return (async function* () { /* empty */ })(); }
  subscribe(): () => void { return () => undefined; }
}

const sealed = (record: Record<string, unknown>) => ({ ...record, crc: crc32(JSON.stringify(record)) });
const framed = (record: Record<string, unknown>) => `\n${JSON.stringify(sealed(record))}\n`;
const add = (id: string, text: string) => framed({
  schema: 'memory.event/2', id: `ev-${id}`, at, actor: { kind: 'human', id: 'user-1', harness: 'pi' }, type: 'add',
  item: { id, kind: 'order', scope: { kind: 'global', key: 'all' }, text, source: { type: 'coordinator_order' }, supersedes: [] },
});
const message = (id: string) => framed({
  schema: 'memory.journal/2', id, at, cwd: '/synthetic', session: { id: 'sess-1', role: 'main' }, origin: 'human', originEvidence: [],
  text: 'synthetic journal text', withheld: null, redactions: [], textBytes: 22, sha256: 'abc',
});

function store(t: TestContext): { root: string; memory: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-memory-ingest-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  return { root, memory: join(root, 'memory') };
}
const put = (file: string, content: string, ageDays = 0) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  const when = new Date(now.getTime() - ageDays * day);
  utimesSync(file, when, when);
};
const poll = async (root: string, log = new Log()) => {
  const spec = sourceTable({ agentRoot: root, orchRoot: join(root, 'orch'), laneStatusDir: join(root, 'lane-status') }).find(item => item.id === 'intent-memory')!;
  const worker = new SourceIngestion(log, { id: spec.id, feeds: spec.feeds, backfillWindowDays: 14, now: () => now });
  await worker.poll();
  worker.close();
  return { log, status: worker.status };
};
const types = (log: Log) => log.events.map(event => event.type);

test('events.jsonl is read from byte 0 whatever its age; a journal file outside the window is skipped', async t => {
  const { root, memory } = store(t);
  put(join(memory, 'events.jsonl'), add('item-1', 'synthetic order A'), 400);
  put(join(memory, 'journal/sess-1.jsonl'), message('msg-1'), 1);
  put(join(memory, 'journal/sess-old.jsonl'), message('msg-old'), 60);
  const { log, status } = await poll(root);
  assert.deepEqual(types(log).sort(), ['MemoryItemRecorded', 'MemoryMessageRecorded']);
  assert.equal(status.files, 2);
  assert.equal(status.errors, 0);
});

test('answers, blobs, the prune cursor and odd journal names are never opened', async t => {
  const { root, memory } = store(t);
  const never = [join(memory, 'answers/sess-1.jsonl'), join(memory, 'blobs/abc.txt'), join(memory, '.journal-prune'), join(memory, 'journal/has space.jsonl'), join(memory, 'journal/nested/sess-2.jsonl')];
  for (const file of never) { put(file, message('msg-x')); chmodSync(file, 0o000); }
  t.after(() => { for (const file of never) { try { chmodSync(file, 0o600); } catch { /* removed with the tree */ } } });
  const { log, status } = await poll(root);
  assert.deepEqual([log.events.length, status.files, status.errors], [0, 0, 0]);
});

test('a symlinked configured agent root ingests both memory events and journal records', async t => {
  const { root, memory } = store(t);
  put(join(memory, 'events.jsonl'), add('item-1', 'synthetic order A'));
  put(join(memory, 'journal/sess-1.jsonl'), message('msg-1'));
  const alias = join(root, 'agent-link');
  symlinkSync(root, alias);
  const { log, status } = await poll(alias);
  assert.deepEqual(types(log).sort(), ['MemoryItemRecorded', 'MemoryMessageRecorded']);
  assert.deepEqual([log.saved.size, status.files, status.errors], [2, 2, 0]);
});

test('a symlinked store root is skipped and a store that appears later is picked up', async t => {
  const { root, memory } = store(t);
  const elsewhere = mkdtempSync(join(tmpdir(), 'pi-console-memory-elsewhere-'));
  t.after(() => { rmSync(elsewhere, { recursive: true, force: true }); });
  put(join(elsewhere, 'events.jsonl'), add('item-1', 'synthetic order A'));
  put(join(elsewhere, 'journal/sess-1.jsonl'), message('msg-1'));
  symlinkSync(elsewhere, memory);
  const { log, status } = await poll(root);
  assert.deepEqual([log.events.length, log.saved.size, status.files], [0, 0, 0]);
  rmSync(memory);
  assert.equal((await poll(root)).log.events.length, 0, 'a missing store is empty');
  put(join(memory, 'events.jsonl'), add('item-1', 'synthetic order A'));
  assert.deepEqual(types((await poll(root)).log), ['MemoryItemRecorded']);
});

test('a secret-shaped token in an item never reaches an event and the journal text is dropped', async t => {
  const { root, memory } = store(t);
  const token = `sk-${'q9W8e7R6'.repeat(3)}`;
  put(join(memory, 'events.jsonl'), add('item-1', `rotate ${token} soon`));
  put(join(memory, 'journal/sess-1.jsonl'), message('msg-1'));
  const text = JSON.stringify((await poll(root)).log.events);
  assert.ok(!text.includes(token));
  assert.ok(!text.includes('synthetic journal text'));
  assert.ok(text.includes('[REDACTED]'));
});

test('the intent-memory switch defaults on and can be turned off in config', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-memory-config-'));
  assert.equal(loadConfig(directory).sources['intent-memory'], true);
  assert.equal(loadConfig(directory, { sources: { 'intent-memory': false } }).sources['intent-memory'], false);
  rmSync(directory, { recursive: true, force: true });
});
