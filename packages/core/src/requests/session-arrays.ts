import type { SessionRecord } from './model.ts';

export const sessionArrays = ['observations', 'explicitIds', 'requestIds'] as const;
export type SessionArray = typeof sessionArrays[number];
type Changes = Map<SessionArray, Set<number>>;
const changes = new WeakMap<SessionRecord, Changes>();

/** Persistence hints only: the JSON state remains sufficient to restore/replay without this cache. */
export function changedIndices(record: SessionRecord, field: SessionArray): ReadonlySet<number> {
  return changes.get(record)?.get(field) ?? new Set();
}

export function changeIndex(record: SessionRecord, field: SessionArray, index: number): void {
  let fields = changes.get(record);
  if (!fields) { fields = new Map(); changes.set(record, fields); }
  let indices = fields.get(field);
  if (!indices) { indices = new Set(); fields.set(field, indices); }
  indices.add(index);
}

export function changeSuffix(record: SessionRecord, field: SessionArray, start: number): void {
  for (let index = start; index < record[field].length; index++) changeIndex(record, field, index);
}

export function committedArrays(record: SessionRecord): void { changes.delete(record); }
