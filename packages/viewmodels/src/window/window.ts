import type { Snapshot } from '@pi-console/contract';

/** The collections the daemon may window in its snapshot, and page over REST. */
export type WindowedCollection = NonNullable<Snapshot['bounded']>[number];
export type Totals = NonNullable<Snapshot['totals']>;

interface Row { id: string }
type Dated = Row & Partial<Record<'startedAt' | 'createdAt' | 'sentAt', string>>;

const activeRules: Record<WindowedCollection, (row: never) => boolean> = {
  sessions: (row: { status: string }) => !['done', 'idle', 'failed'].includes(row.status),
  requests: (row: { status: string }) => row.status !== 'answered',
  questions: (row: { status: string }) => row.status === 'open',
  messages: (row: { status: string }) => row.status !== 'read',
  jobs: (row: { status: string }) => row.status === 'running',
};

/** The daemon's "active" rule: an active row is always in a snapshot, so a previously active row missing from one is stale. */
export const isActive = (collection: WindowedCollection, row: Row): boolean => (activeRules[collection] as (row: Row) => boolean)(row);

const keyOf = (row: Dated) => row.startedAt ?? row.createdAt ?? row.sentAt ?? '';
const ascending = (a: Dated, b: Dated) => (keyOf(a) === keyOf(b) ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : keyOf(a) < keyOf(b) ? -1 : 1);

/**
 * A bounded snapshot's window of `collection` merged into what the client already holds: the snapshot wins by id, history
 * pages loaded earlier stay, and rows that were active but are missing from the snapshot are dropped (they are no longer active).
 */
export function mergeSnapshot<T extends Row>(collection: WindowedCollection, previous: readonly T[], incoming: readonly T[]): T[] {
  const fresh = new Set(incoming.map(row => row.id));
  const kept = previous.filter(row => !fresh.has(row.id) && !isActive(collection, row));
  return [...kept, ...incoming].sort(ascending);
}

/** A history page (or session detail) merged into the current list: rows already held win, since deltas are newer than any fetch. */
export function mergeHistory<T extends Row>(current: readonly T[], older: readonly T[]): T[] {
  const held = new Set(current.map(row => row.id));
  const added = older.filter(row => !held.has(row.id));
  return added.length === 0 ? [...current] : [...current, ...added].sort(ascending);
}
