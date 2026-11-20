import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './security.ts';
import { pageOf, windowed } from './paging.ts';

type Row = { id: string; createdAt: string; sessionId: string; status: string };
const rows: Row[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, createdAt: `2026-01-0${String(index + 1)}`, sessionId: index % 2 === 0 ? 's1' : 's2', status: 'open' }));
const url = (query: string) => new URL(`http://x/requests?${query}`);
const page = (query: string, source: Row[] = rows) => pageOf('requests', source, url(query)) as { items: Row[]; hasMore: boolean; total: number; nextCursor: string | null };
const status = (action: () => unknown) => { try { action(); } catch (error) { return (error as HttpError).status; } return undefined; };

test('without limit the caller gets the complete list', () => {
  assert.equal(pageOf('requests', rows, url('order=asc')), undefined);
});

test('invalid limit, order and cursor are 400', () => {
  for (const query of ['limit=0', 'limit=1001', 'limit=abc', 'limit=1.5', 'limit=-1', 'limit=2&order=up', 'limit=2&after=nope']) assert.equal(status(() => page(query)), 400, query);
});

test('pages ascending and descending with a cursor and no gap', () => {
  const first = page('limit=2');
  assert.deepEqual(first.items.map(row => row.id), ['a', 'b']);
  assert.equal(first.hasMore, true);
  assert.equal(first.total, 5);
  const second = page(`limit=2&after=${first.nextCursor}`);
  assert.deepEqual(second.items.map(row => row.id), ['c', 'd']);
  const last = page(`limit=2&after=${second.nextCursor}`);
  assert.deepEqual(last.items.map(row => row.id), ['e']);
  assert.deepEqual([last.hasMore, last.nextCursor], [false, null]);
  const desc = page('limit=2&order=desc');
  assert.deepEqual(desc.items.map(row => row.id), ['e', 'd']);
  assert.deepEqual(page(`limit=9&order=desc&after=${desc.nextCursor}`).items.map(row => row.id), ['c', 'b', 'a']);
});

test('a cursor past the end yields an empty page, and a cursor from another collection is rejected', () => {
  const lastCursor = page('limit=5');
  assert.equal(lastCursor.nextCursor, null);
  const beforeEnd = page('limit=4');
  const tail = page(`limit=4&after=${page('limit=4&after=' + beforeEnd.nextCursor).items.length ? beforeEnd.nextCursor : ''}`);
  assert.deepEqual(tail.items.map(row => row.id), ['e']);
  const sessionsCursor = (pageOf('sessions', rows.map(row => ({ ...row, startedAt: row.createdAt })), url('limit=1')) as { nextCursor: string }).nextCursor;
  assert.equal(status(() => page(`limit=1&after=${sessionsCursor}`)), 400);
  const wrongShape = Buffer.from('["requests","k"]').toString('base64url');
  assert.equal(status(() => page(`limit=1&after=${wrongShape}`)), 400);
});

test('sessionId scopes requests and messages, but not sessions', () => {
  assert.deepEqual(page('limit=9&sessionId=s2').items.map(row => row.id), ['b', 'd']);
  assert.equal(page('limit=9&sessionId=s2').total, 2);
  const messages = [
    { id: 'm1', sentAt: '1', fromSessionId: 's1', toSessionId: 's2', status: 'read' },
    { id: 'm2', sentAt: '2', fromSessionId: 's3', toSessionId: 's4', status: 'read' },
  ];
  assert.deepEqual((pageOf('messages', messages, url('limit=9&sessionId=s2')) as { items: { id: string }[] }).items.map(row => row.id), ['m1']);
  const sessions = [{ id: 'x', startedAt: '1' }, { id: 'y', startedAt: '2' }];
  assert.equal((pageOf('sessions', sessions, url('limit=9&sessionId=s9')) as { total: number }).total, 2);
});

test('windowed keeps active rows beyond the newest 200', () => {
  const many = Array.from({ length: 205 }, (_, index) => ({ id: `r${String(index).padStart(3, '0')}`, createdAt: String(index).padStart(3, '0'), status: index === 0 ? 'open' : 'answered' }));
  const kept = windowed('requests', many);
  assert.equal(kept.length, 201);
  assert.equal(kept[0].id, 'r000');
});
