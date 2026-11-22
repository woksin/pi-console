import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiV1Schema, validate, type SourceCheckpoint } from '@pi-console/contract';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';
import { FileTranscriptReader } from './file-transcripts.ts';
import { TranscriptSources } from './transcript-sources.ts';

const at = '2026-01-02T03:04:05.000Z';
const line = (value: unknown) => JSON.stringify(value) + '\n';
const header = line({ type: 'session', version: 3, id: 's', timestamp: at, cwd: '/synthetic' });
const message = (id: string, content = 'synthetic λ') => ({ type: 'message', id, timestamp: at, message: { role: 'user', content } });

function fixture(t: { after: (callback: () => void | Promise<void>) => void }, content: string, scanner?: (value: string) => string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-file-history-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'file.jsonl');
  writeFileSync(path, header + content);
  const stat = statSync(path);
  const checkpoint: SourceCheckpoint = { source: 'session-jsonl', path, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, generation: 0,
    offset: stat.size, size: stat.size, mtimeMs: stat.mtimeMs, headHash: createHash('sha256').update(readFileSync(path).subarray(0, 512)).digest('hex') };
  const reader = new FileTranscriptReader(new TranscriptSources({ checkpoints: async () => [checkpoint] }, [root]), scanner);
  t.after(() => reader.close());
  return { reader, path, checkpoint };
}

test('exclusive byte cursors traverse metadata, malformed, oversized, UTF-8, CRLF and torn tails', async t => {
  const first = line(message('first'));
  const skipped = '\n{broken}\n' + line({ type: 'metadata' }) + line({ huge: 'x'.repeat(300_000) });
  const last = line(message('last')).replace('\n', '\r\n');
  const torn = JSON.stringify(message('torn'));
  const { reader, path } = fixture(t, first + skipped + last + torn);
  const before = readFileSync(path);
  const mtime = statSync(path).mtimeMs;
  const page = await reader.page('s', 0, 1);
  validate(page, apiV1Schema.$defs.transcript, apiV1Schema);
  assert.equal(page.items[0]?.cursor, Buffer.byteLength(header) + 1);
  assert.equal(page.hasMore, true);
  const next = await reader.page('s', page.nextCursor, 1);
  assert.equal(next.items[0]?.id, 'last');
  assert.equal(next.items[0]?.cursor, Buffer.byteLength(header + first + skipped) + 1);
  assert.equal(next.hasMore, false);
  assert.deepEqual(await reader.page('s', next.nextCursor, 2), { items: [], nextCursor: next.nextCursor, hasMore: false });
  assert.deepEqual(await reader.page('s', Number.MAX_SAFE_INTEGER, 2), { items: [], nextCursor: Number.MAX_SAFE_INTEGER, hasMore: false });
  assert.equal((await reader.page('s', page.nextCursor + 8, 2)).items[0]?.id, 'last', 'middle-of-line seeks never parse a fragment');
  assert.equal(await reader.around('s', 'torn', 3), undefined);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(statSync(path).mtimeMs, mtime);
  appendFileSync(path, '\n');
  assert.equal((await reader.page('s', next.nextCursor, 2)).items[0]?.id, 'torn');
});

test('descending pages traverse sparse byte cursors from the tail without duplicates', async t => {
  const skipped = '\n{broken}\n' + line({ type: 'metadata' }) + line({ huge: 'x'.repeat(600_000) });
  const { reader, path } = fixture(t, line(message('first')) + skipped + line(message('last')).replace('\n', '\r\n') + JSON.stringify(message('torn')));
  const before = statSync(path);
  const tail = await reader.page('s', Number.MAX_SAFE_INTEGER, 1, 'desc');
  assert.deepEqual(tail.items.map(item => item.id), ['last']);
  assert.equal(tail.hasMore, true);
  const older = await reader.page('s', tail.nextCursor, 1, 'desc');
  assert.deepEqual(older.items.map(item => item.id), ['first']);
  assert.equal(older.hasMore, false);
  assert.ok(older.nextCursor < tail.nextCursor);
  assert.deepEqual(await reader.page('s', 0, 1, 'desc'), { items: [], nextCursor: 0, hasMore: false });
  assert.deepEqual((await reader.page('s', older.nextCursor, 1, 'desc')).items, []);
  assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  assert.equal(statSync(path).size, before.size);
});

for (const count of [0, 1, 4, 10_000]) test(`descending ${String(count)}-entry transcripts have exact page boundaries`, async t => {
  let scanned = 0;
  const { reader } = fixture(t, Array.from({ length: count }, (_, i) => line(message(String(i)))).join(''), value => { if (/^\d+$/.test(value)) scanned++; return value; });
  const tail = await reader.page('s', Number.MAX_SAFE_INTEGER, 4, 'desc');
  validate(tail, apiV1Schema.$defs.transcript, apiV1Schema);
  assert.deepEqual(tail.items.map(item => item.id), Array.from({ length: Math.min(count, 4) }, (_, i) => String(count - 1 - i)));
  assert.equal(tail.hasMore, count > 4);
  if (count === 10_000) {
    assert.ok(scanned < 3000, `tail must skip the prefix, scanned ${String(scanned)} records`);
    const found = tail.items.map(item => item.id);
    let page = tail;
    while (page.hasMore) {
      page = await reader.page('s', page.nextCursor, 1000, 'desc');
      found.push(...page.items.map(item => item.id));
    }
    assert.deepEqual(found, Array.from({ length: count }, (_, i) => String(count - i - 1)));
  }
});

test('around reports older history independently of newer history', async t => {
  const { reader } = fixture(t, Array.from({ length: 9 }, (_, i) => line(message(String(i)))).join(''));
  assert.equal((await reader.around('s', '0', 4))?.hasOlder, false);
  assert.equal((await reader.around('s', '4', 4))?.hasOlder, true);
  assert.equal((await reader.around('s', '8', 4))?.hasOlder, true);
});

test('around centers, fills at both ends and revalidates cached offsets on rewrite', async t => {
  const { reader, path, checkpoint } = fixture(t, Array.from({ length: 9 }, (_, i) => line(message(String(i)))).join(''));
  for (const [anchor, ids, more] of [['0', ['0', '1', '2', '3'], true], ['4', ['3', '4', '5', '6'], true], ['8', ['5', '6', '7', '8'], false]] as const) {
    const page = await reader.around('s', anchor, 4);
    assert.deepEqual(page?.items.map(item => item.id), ids);
    assert.equal(page?.hasMore, more);
    assert.deepEqual(await reader.around('s', anchor, 4), page);
  }
  assert.equal(await reader.around('s', 'missing', 4), undefined);
  writeFileSync(path, header + line(message('new')));
  assert.equal(await reader.around('s', '4', 4), undefined);
  const stat = statSync(path);
  Object.assign(checkpoint, { size: stat.size, mtimeMs: stat.mtimeMs, generation: 1, headHash: createHash('sha256').update(readFileSync(path).subarray(0, 512)).digest('hex') });
  assert.equal((await reader.around('s', 'new', 4))?.items[0]?.id, 'new');
});

test('all bodies are redacted on reread, scan before truncation, and scanner failure is closed', async t => {
  const secret = 'ghp_' + 'x'.repeat(36);
  const { reader } = fixture(t, line(message('secret', 'a'.repeat(220) + secret)));
  const page = await reader.page('s', 0, 10);
  assert.ok(!JSON.stringify(page).includes(secret));
  assert.equal(page.items[0]?.text.length, 200);
  const failed = fixture(t, line(message('no-leak', secret)), () => { throw new Error('synthetic scanner failure'); });
  assert.deepEqual((await failed.reader.page('s', 0, 10)).items, []);
  let redactNow = false;
  const changed = fixture(t, line(message('cached', 'sensitive')), value => redactNow && value === 'sensitive' ? '[REDACTED]' : value);
  assert.equal((await changed.reader.around('s', 'cached', 3))?.items[0]?.text, 'sensitive');
  redactNow = true;
  assert.equal((await changed.reader.around('s', 'cached', 3))?.items[0]?.text, '[REDACTED]');
});

test('large cold anchor scans yield; repeat lookup skips the prefix and keeps source untouched', async t => {
  let scanned = 0;
  const body = Array.from({ length: 15_000 }, (_, i) => line(message(String(i), 'safe '.repeat(20)))).join('');
  const { reader, path } = fixture(t, body, value => { scanned++; return value; });
  const before = statSync(path);
  let ticks = 0;
  const interval = setInterval(() => ticks++, 0);
  t.after(() => clearInterval(interval));
  const page = await reader.around('s', '13000', 5);
  const cold = scanned;
  assert.equal(page?.items.length, 5);
  assert.ok(ticks > 0);
  scanned = 0;
  assert.deepEqual(await reader.around('s', '13000', 5), page);
  assert.ok(scanned < cold / 2, `repeat scan ${scanned} vs cold ${cold}`);
  assert.equal(statSync(path).mtimeMs, before.mtimeMs);
  assert.equal(statSync(path).size, before.size);
});

test('two active/eight queued scans bound saturation; health responds and shutdown drains owners', async t => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let active = 0;
  class HeldSources extends TranscriptSources {
    override async resolve() { active++; await barrier; return undefined; }
  }
  const reader = new FileTranscriptReader(new HeldSources({ checkpoints: async () => [] }, []));
  const settled = Promise.allSettled(Array.from({ length: 10 }, () => reader.page('s', 0, 1)));
  assert.equal(active, 2);
  await assert.rejects(reader.page('s', 0, 1), { status: 503, message: 'Transcript unavailable' });
  const spec = await specDaemon(undefined, { transcripts: reader });
  t.after(() => spec.close());
  assert.equal((await call(spec.daemon.port, '/api/v1/health', { headers: { Authorization: `Bearer ${spec.token}` } })).status, 200);
  const closing = reader.close();
  release();
  await closing;
  const results = await settled;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter(result => result.status === 'rejected').length, 8);
  await assert.rejects(reader.page('s', 0, 1), { status: 503 });
});
