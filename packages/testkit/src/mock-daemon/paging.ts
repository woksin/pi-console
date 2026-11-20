import { HttpError } from './security.ts';

// The mock's own implementation of the bounded snapshot and keyset paging (docs/api/v1.md), independent of the daemon's
// so the conformance suite compares two implementations of one contract.

type Row = { id: string };
export type Collection = 'sessions' | 'requests' | 'questions' | 'messages' | 'jobs';

const recent = 200;
const text = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const sortKey: Record<Collection, string> = { sessions: 'startedAt', requests: 'createdAt', questions: 'createdAt', messages: 'sentAt', jobs: 'startedAt' };
const keyOf = (collection: Collection, row: Row) => (row as unknown as Record<string, string>)[sortKey[collection]];
const ascending = (collection: Collection) => (a: Row, b: Row) => text(keyOf(collection, a), keyOf(collection, b)) || text(a.id, b.id);

const activeRules: Record<Collection, (row: Row & { status: string }) => boolean> = {
  sessions: row => !['done', 'idle', 'failed'].includes(row.status),
  requests: row => row.status !== 'answered',
  questions: row => row.status === 'open',
  messages: row => row.status !== 'read',
  jobs: row => row.status === 'running',
};

/** Active rows plus the newest `recent`, in ascending order. */
export function windowed<T extends Row>(collection: Collection, rows: T[]): T[] {
  const sorted = [...rows].sort(ascending(collection));
  const newest = new Set(sorted.slice(-recent).map(row => row.id));
  return sorted.filter(row => newest.has(row.id) || activeRules[collection](row as unknown as Row & { status: string }));
}

const encode = (collection: Collection, row: Row) => Buffer.from(JSON.stringify([collection, keyOf(collection, row), row.id])).toString('base64url');

const isCursorFor = (collection: Collection, value: unknown): value is [string, string, string] =>
  Array.isArray(value) && value.length === 3 && value[0] === collection && value.slice(1).every(part => typeof part === 'string');

function decode(collection: Collection, cursor: string): { key: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (isCursorFor(collection, value)) return { key: value[1], id: value[2] };
  } catch { /* invalid below */ }
  throw new HttpError(400, 'Invalid after');
}

const inRange = (limit: number) => limit >= 1 && limit <= 1000;

function limitOf(url: URL): number | undefined {
  const limitText = url.searchParams.get('limit');
  if (limitText === null) return undefined;
  const limit = /^\d+$/.test(limitText) ? Number(limitText) : 0;
  if (!inRange(limit)) throw new HttpError(400, 'Invalid limit');
  return limit;
}

function directionOf(url: URL): 1 | -1 {
  const order = url.searchParams.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw new HttpError(400, 'Invalid order');
  return order === 'desc' ? -1 : 1;
}

function scopedTo(collection: Collection, rows: Row[], sessionId: string | null): Row[] {
  if (sessionId === null || collection === 'sessions') return rows;
  return rows.filter(row => {
    const item = row as unknown as Record<string, string>;
    return collection === 'messages' ? [item.fromSessionId, item.toSessionId].includes(sessionId) : item.sessionId === sessionId;
  });
}

/** Index of the first row strictly after the cursor in `direction` (0 without a cursor, -1 when none follows). */
function startOf(collection: Collection, ordered: Row[], direction: 1 | -1, cursor: string | null): number {
  if (cursor === null) return 0;
  const position = decode(collection, cursor);
  return ordered.findIndex(row => direction * (text(keyOf(collection, row), position.key) || text(row.id, position.id)) > 0);
}

/** `{items, nextCursor, hasMore, total}` when the URL carries `limit`, otherwise `undefined` (the caller returns the complete list). */
export function pageOf(collection: Collection, rows: Row[], url: URL): unknown {
  const limit = limitOf(url);
  if (limit === undefined) return undefined;
  const direction = directionOf(url);
  const scoped = scopedTo(collection, rows, url.searchParams.get('sessionId'));
  const compare = ascending(collection);
  const ordered = [...scoped].sort((a, b) => direction * compare(a, b));
  const start = startOf(collection, ordered, direction, url.searchParams.get('after'));
  const items = start < 0 ? [] : ordered.slice(start, start + limit);
  const hasMore = start >= 0 && start + items.length < ordered.length;
  const last = items.at(-1);
  return { items, hasMore, total: scoped.length, nextCursor: hasMore && last ? encode(collection, last) : null };
}
