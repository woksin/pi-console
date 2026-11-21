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

for (const id of ['intent-memory', 'lane-messages']) for (const created of ['directory', 'symlink']) {
  test(`${id} resolves a missing configured root beneath an alias created as a ${created} like a fresh start`, async t => {
    const { root } = store(t);
    const alias = join(root, 'configured');
    symlinkSync(root, alias);
    const missing = join(alias, 'late', 'store');
    const spec = sourceTable({ agentRoot: missing, orchRoot: join(root, 'orch'), laneStatusDir: missing }).find(item => item.id === id)!;
    const log = new Log();
    const worker = new SourceIngestion(log, { id: spec.id, feeds: spec.feeds, backfillWindowDays: 14, now: () => now });
    t.after(() => worker.close());
    await worker.poll();
    assert.equal(log.events.length, 0);
    mkdirSync(join(root, 'late'));
    if (created === 'symlink') {
      mkdirSync(join(root, 'target'));
      symlinkSync(join(root, 'target'), missing);
    } else mkdirSync(missing);
    if (id === 'intent-memory') put(join(missing, 'memory/events.jsonl'), add('late', 'synthetic order'));
    else put(join(missing, 'L192.status'), 'working since 2026-11-20T09:00:00Z\n');
    await worker.poll();
    assert.deepEqual(types(log), [id === 'intent-memory' ? 'MemoryItemRecorded' : 'LaneStatusChanged']);
  });
}

for (const id of ['intent-memory', 'lane-messages']) for (const created of ['directory', 'symlink']) {
  test(`${id} resolves a configured dangling root alias whose target appears as a ${created} like a fresh start`, async t => {
    const { root } = store(t);
    const alias = join(root, 'configured');
    const target = join(root, 'late');
    symlinkSync('late', alias);
    const spec = sourceTable({ agentRoot: alias, orchRoot: join(root, 'orch'), laneStatusDir: alias }).find(item => item.id === id)!;
    const log = new Log();
    const worker = new SourceIngestion(log, { id: spec.id, feeds: spec.feeds, backfillWindowDays: 14, now: () => now });
    t.after(() => worker.close());
    await worker.poll();
    assert.equal(log.events.length, 0);
    if (created === 'symlink') {
      mkdirSync(join(root, 'elsewhere'));
      symlinkSync('elsewhere', target);
    } else mkdirSync(target);
    if (id === 'intent-memory') put(join(alias, 'memory/events.jsonl'), add('late-alias', 'synthetic order'));
    else put(join(alias, 'L192.status'), 'working since 2026-11-20T09:00:00Z\n');
    await worker.poll();
    assert.deepEqual(types(log), [id === 'intent-memory' ? 'MemoryItemRecorded' : 'LaneStatusChanged']);
  });
}

for (const id of ['intent-memory', 'lane-messages']) for (const late of [false, true]) {
  test(`${id} resolves nested relative configured links against canonical parents (${late ? 'pending' : 'startup'})`, async t => {
    const { root } = store(t);
    mkdirSync(join(root, 'store/config'), { recursive: true });
    symlinkSync('store/config', join(root, 'parent'));
    symlinkSync('../latest', join(root, 'store/config/root'));
    const configured = join(root, 'parent/root');
    const create = () => {
      mkdirSync(join(root, 'store/latest'));
      if (id === 'intent-memory') put(join(configured, 'memory/events.jsonl'), add('nested', 'synthetic order'));
      else put(join(configured, 'L192.status'), 'working since 2026-11-20T09:00:00Z\n');
    };
    if (!late) create();
    const spec = sourceTable({ agentRoot: configured, orchRoot: join(root, 'orch'), laneStatusDir: configured }).find(item => item.id === id)!;
    const log = new Log();
    const worker = new SourceIngestion(log, { id: spec.id, feeds: spec.feeds, backfillWindowDays: 14, now: () => now });
    t.after(() => worker.close());
    if (late) {
      await worker.poll();
      assert.equal(log.events.length, 0);
      create();
    }
    await worker.poll();
    assert.deepEqual(types(log), [id === 'intent-memory' ? 'MemoryItemRecorded' : 'LaneStatusChanged']);
  });
}

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
