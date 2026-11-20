import { compareText } from '../projector/canonical.ts';

/** One list row reduced to its sort key, so selection and paging sort strings and only map the rows they return. */
export interface Entry<Out> {
  /** Primary sort key (the list's timestamp); ties break by `id`, both by `compareText`. */
  key: string;
  id: string;
  /** Always part of the screen snapshot, whatever its age. */
  active: boolean;
  build: () => Out;
}

export type PageCollection = 'sessions' | 'requests' | 'questions' | 'messages' | 'jobs' | 'resets';
export type PageOrder = 'asc' | 'desc';

export interface PageParams { limit: number; after?: string; order?: PageOrder }

export interface Page<Out> { items: Out[]; nextCursor: string | null; hasMore: boolean; total: number }

/** A cursor that is malformed or was minted for another collection. The API maps it to 400. */
export class InvalidCursorError extends Error {
  constructor() { super('Invalid after'); }
}

export const compareEntries = (a: { key: string; id: string }, b: { key: string; id: string }): number =>
  compareText(a.key, b.key) || compareText(a.id, b.id);

/** Opaque keyset cursor: base64url of `[collection, key, id]`. Stable under concurrent upserts, unlike an offset. */
export const encodeCursor = (collection: PageCollection, key: string, id: string): string =>
  Buffer.from(JSON.stringify([collection, key, id])).toString('base64url');

const isCursorFor = (collection: PageCollection, value: unknown): value is [string, string, string] =>
  Array.isArray(value) && value.length === 3 && value[0] === collection && value.slice(1).every(part => typeof part === 'string');

export function decodeCursor(collection: PageCollection, text: string): { key: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (isCursorFor(collection, value)) return { key: value[1], id: value[2] };
  } catch { /* falls through to the error below */ }
  throw new InvalidCursorError();
}

/** Entries in the list's total ascending order. */
export const sortedEntries = <Out>(entries: Entry<Out>[]): Entry<Out>[] => entries.sort(compareEntries);

/** The `count` newest entries by one pass with a bounded buffer: no full sort of the collection. */
export function newest<Out>(entries: Iterable<Entry<Out>>, count: number): Entry<Out>[] {
  if (count <= 0) return [];
  const newestFirst = (a: Entry<Out>, b: Entry<Out>) => compareEntries(b, a);
  let buffer: Entry<Out>[] = [];
  let cutoff: Entry<Out> | undefined;
  for (const entry of entries) {
    if (cutoff && compareEntries(entry, cutoff) <= 0) continue;
    buffer.push(entry);
    if (buffer.length >= count * 2) {
      buffer = buffer.sort(newestFirst).slice(0, count);
      cutoff = buffer[count - 1];
    }
  }
  return buffer.sort(newestFirst).slice(0, count);
}

/** Active entries plus the `recent` newest, in ascending order, and whether anything was left out. */
export function windowOf<Out>(entries: Entry<Out>[], recent: number): { items: Out[]; total: number; bounded: boolean } {
  const chosen = new Map<string, Entry<Out>>();
  for (const entry of entries) if (entry.active) chosen.set(entry.id, entry);
  for (const entry of newest(entries, recent)) chosen.set(entry.id, entry);
  const items = sortedEntries([...chosen.values()]).map(entry => entry.build());
  return { items, total: entries.length, bounded: chosen.size < entries.length };
}

/** First index of `list` (ordered by `direction`) strictly after the cursor. */
function indexAfter<Out>(list: Entry<Out>[], cursor: { key: string; id: string }, direction: 1 | -1): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (direction * compareEntries(list[middle], cursor) > 0) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function pageOf<Out>(collection: PageCollection, entries: Entry<Out>[], params: PageParams): Page<Out> {
  const direction = params.order === 'desc' ? -1 : 1;
  const ordered = sortedEntries(entries);
  if (direction === -1) ordered.reverse();
  const start = params.after === undefined ? 0 : indexAfter(ordered, decodeCursor(collection, params.after), direction);
  const slice = ordered.slice(start, start + params.limit);
  const hasMore = start + slice.length < ordered.length;
  const last = slice.at(-1);
  return {
    items: slice.map(entry => entry.build()), hasMore, total: entries.length,
    nextCursor: hasMore && last ? encodeCursor(collection, last.key, last.id) : null,
  };
}
