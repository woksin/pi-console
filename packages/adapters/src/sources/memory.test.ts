import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapLine, type Mapper } from '../tailing/events.ts';
import { FileTailer } from '../tailing/tailer.ts';
import { MemoryLog } from '../tailing/memory-log.test.ts';
import { crc32, memoryEventMapper, memoryJournalMapper } from './memory.ts';

const actor = { kind: 'human', id: 'user-1', harness: 'pi' };
const at = '2026-07-01T10:00:00Z';

/** A record as the producer writes it: `crc` last, computed over the record without it. */
const sealed = (record: Record<string, unknown>): Record<string, unknown> => ({ ...record, crc: crc32(JSON.stringify(record)) });
/** Producer framing: a blank line, the record, a newline. */
const framed = (record: Record<string, unknown>) => `\n${JSON.stringify(sealed(record))}\n`;
const event = (id: string, type: string, rest: Record<string, unknown>) => ({ schema: 'memory.event/2', id, at, actor, type, ...rest });
const item = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'directive', scope: { kind: 'session', key: 'sess-1' }, text: 'synthetic directive A',
  source: { type: 'user_message', ref: 'msg-1', span: { start: 0, end: 5 } }, authority: { mode: 'command', ruleVersion: '1', commandRef: 'c' }, supersedes: [], ...over,
});
const journal = (id: string, over: Record<string, unknown> = {}) => ({
  schema: 'memory.journal/2', id, at, cwd: '/synthetic', session: { id: 'sess-1', role: 'main' }, origin: 'human', originEvidence: [],
  text: 'synthetic message text', withheld: null, redactions: [], textBytes: 22, sha256: 'abc', ...over,
});

const checkpoint = { source: 'intent-memory', path: '/synthetic/events.jsonl', identity: 'synthetic', generation: 0, offset: 0, size: 0, mtimeMs: 0, headHash: '' };
type Mapped = { type: string; subject: string; payload: Record<string, any>; refs: { entryId: string | null } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const map = (record: Record<string, unknown>, mapper: Mapper) => mapLine(JSON.stringify(record), 0, { mapper, checkpoint }) as unknown as Mapped[];
const types = (rows: { type: string }[]) => rows.map(row => row.type);

test('crc32 is the IEEE checksum in lowercase hex', () => {
  assert.equal(crc32('123456789'), 'cbf43926');
  assert.equal(crc32(''), '00000000');
});

test('add events map every kind, authority mode and supersedes list to MemoryItemRecorded', () => {
  const kinds = ['directive', 'order', 'decision'].map(kind => item(`item-${kind}`, { kind, source: { type: kind === 'order' ? 'coordinator_order' : 'agent_decision' }, authority: undefined }));
  const rows = [...kinds, item('item-auto', { authority: { mode: 'auto', ruleVersion: '1' }, supersedes: ['item-1'], gloss: 'gloss A' }), item('item-none', { authority: { mode: 'none', ruleVersion: '1' } })]
    .map((entry, index) => map(sealed(event(`ev-${index}`, 'add', { item: entry })), memoryEventMapper)[0]);
  assert.deepEqual(types(rows), Array(5).fill('MemoryItemRecorded'));
  assert.deepEqual(rows.map(row => row.payload.authorityMode), [null, null, null, 'auto', 'none']);
  assert.deepEqual([rows[3].payload.supersedes, rows[3].payload.gloss, rows[3].subject, rows[3].refs?.entryId], [['item-1'], 'gloss A', 'source:memory-item:item-auto', 'ev-3']);
  assert.deepEqual([rows[0].payload.sourceMessageId, map(sealed(event('ev-x', 'add', { item: item('item-x') })), memoryEventMapper)[0].payload.sourceMessageId], [null, 'msg-1']);
});

test('coordinator orders preserve their injected journal message reference for session linkage', () => {
  const order = item('order-1', {
    kind: 'order', scope: { kind: 'lane', key: 'L1' }, text: 'synth',
    source: { type: 'coordinator_order', ref: 'msg-injected', span: { start: 0, end: 5 } }, authority: undefined,
  });
  const [mapped] = map(sealed(event('ev-order', 'add', { item: order })), memoryEventMapper);
  assert.equal(mapped.type, 'MemoryItemRecorded');
  assert.deepEqual([mapped.payload.sourceType, mapped.payload.sourceMessageId, mapped.payload.scopeKind], ['coordinator_order', 'msg-injected', 'lane']);
  const [message] = map(sealed(journal('msg-injected', { origin: 'injected', injectedKind: 'lane_message' })), memoryJournalMapper);
  assert.deepEqual([message.payload.messageId, message.payload.sessionId], ['msg-injected', 'sess-1']);
});

test('confirm, every retire status and both classify shapes map to their events', () => {
  const rows = [
    event('ev-1', 'confirm', { itemId: 'item-1', via: 'ui' }),
    ...['done', 'superseded', 'withdrawn', 'rejected'].map(status => event(`ev-${status}`, 'retire', { itemId: 'item-1', status, reason: 'synthetic reason', source: 'x' })),
    event('ev-2', 'classify', { messageId: 'msg-1', spans: [], whole: 'none' }),
    event('ev-3', 'classify', { messageId: 'msg-2', spans: [{ start: 0, end: 4, result: 'directive', itemIds: ['item-1'] }], whole: null }),
  ].flatMap(record => map(sealed(record), memoryEventMapper));
  assert.deepEqual(types(rows), ['MemoryItemConfirmed', ...Array(4).fill('MemoryItemRetired'), ...Array(2).fill('MemoryMessageClassified')]);
  assert.deepEqual(rows.slice(1, 5).map(row => row.payload.status), ['done', 'superseded', 'withdrawn', 'rejected']);
  assert.deepEqual(rows.slice(5).map(row => [row.payload.whole, row.payload.spanCount]), [['none', 0], [null, 1]]);
});

test('boundary and request_close records are ignored without a warning', () => {
  assert.deepEqual(map(sealed(event('ev-1', 'boundary', { session: 'sess-1' })), memoryEventMapper), []);
  assert.deepEqual(map(sealed(event('ev-2', 'request_close', { requestId: 'r' })), memoryEventMapper), []);
});

test('unknown schema, unknown type, bad crc and missing crc are body-free warnings', () => {
  const secret = 'synthetic-private-marker';
  const bad = [
    sealed({ ...event('ev-1', 'confirm', { itemId: secret }), schema: 'memory.event/3' }),
    sealed(event('ev-2', 'mystery', { itemId: secret })),
    { ...sealed(event('ev-3', 'confirm', { itemId: secret })), crc: '00000000' },
    event('ev-4', 'confirm', { itemId: secret }),
    sealed(event('ev-5', 'retire', { itemId: 'item-1', status: 'imagined', reason: secret })),
  ];
  for (const record of bad) {
    const rows = map(record, memoryEventMapper);
    assert.deepEqual(types(rows), ['SourceSchemaUnknown']);
    assert.ok(!JSON.stringify(rows).includes(secret));
  }
});

test('a secret-shaped token in item text is redacted from the payload', () => {
  const token = `sk-${'a1B2c3D4'.repeat(3)}`;
  const [row] = map(sealed(event('ev-1', 'add', { item: item('item-1', { text: `use ${token} here`, gloss: `also ${token}` }) })), memoryEventMapper);
  assert.equal(row.type, 'MemoryItemRecorded');
  assert.ok(!JSON.stringify(row).includes(token));
  assert.match(String(row.payload.excerpt), /\[REDACTED\]/);
});

test('journal records map origins and withheld text to metadata and never carry the text', () => {
  const rows = [
    journal('msg-1'), journal('msg-2', { origin: 'injected', injectedKind: 'brief' }), journal('msg-3', { origin: 'launch' }),
    journal('msg-4', { origin: 'unattended' }), journal('msg-5', { text: null, withheld: 'too_large' }),
  ].flatMap(record => map(sealed(record), memoryJournalMapper));
  assert.deepEqual(rows.map(row => row.payload.origin), ['human', 'injected', 'launch', 'unattended', 'human']);
  assert.deepEqual(rows.map(row => row.payload.withheld), [false, false, false, false, true]);
  assert.deepEqual([rows[1].payload.injectedKind, rows[0].subject, rows[0].payload.sessionId], ['brief', 'session:sess-1', 'sess-1']);
  assert.ok(!JSON.stringify(rows).includes('synthetic message text'));
});

test('journal records with another schema, a bad crc or a non-string text are warnings', () => {
  for (const record of [sealed(journal('msg-1', { schema: 'memory.journal/3' })), { ...sealed(journal('msg-2')), crc: 'ffffffff' }, sealed(journal('msg-3', { text: 7 }))]) {
    assert.deepEqual(types(map(record, memoryJournalMapper)), ['SourceSchemaUnknown']);
  }
});

test('framing blanks, torn lines, appended records and a store that appears late are handled by the tailer', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-memory-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'events.jsonl');
  const log = new MemoryLog();
  const tailer = new FileTailer(log, 'intent-memory', memoryEventMapper);
  t.after(() => tailer.close());
  assert.equal((await tailer.poll([])).appended, 0);
  writeFileSync(file, framed(event('ev-1', 'add', { item: item('item-1') })) + '{"torn":\n' + framed(event('ev-2', 'confirm', { itemId: 'item-1', via: 'ui' })));
  await tailer.poll([file]);
  appendFileSync(file, framed(event('ev-3', 'boundary', {})) + framed(event('ev-4', 'retire', { itemId: 'item-1', status: 'done', reason: 'r' })));
  await tailer.poll([file]);
  assert.deepEqual(types(log.rows), ['MemoryItemRecorded', 'SourceSchemaUnknown', 'MemoryItemConfirmed', 'MemoryItemRetired']);
  assert.equal((await tailer.poll([file])).appended, 0);
});
