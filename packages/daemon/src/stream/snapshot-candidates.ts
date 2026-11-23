import type { Request, Snapshot } from '@pi-console/contract';
import { compareText } from '@pi-console/core';
import { safeJson } from '../http/output.ts';

export const collections = ['sessions', 'requests', 'questions', 'messages', 'jobs', 'resets'] as const;
export type Collection = typeof collections[number];
type Group = Collection | 'repositories';
type Row = Snapshot[Group][number];

export interface SnapshotEntity {
  key: string; group: Group; row: Row; time: string; tier: number; bytes: number; dependencies: string[];
}

const key = (group: Group, id: string) => `${group}:${id}`;
const actionable = (row: Request) => row.status === 'open' || (row.origin !== 'unproven' && row.answerPossiblyUnseen === true && row.answer != null);
const activeSession = (status: string) => !['done', 'idle', 'failed'].includes(status);

function merged<T extends { id: string }>(normal: readonly T[] = [], active: readonly T[] = []): T[] {
  return [...new Map([...normal, ...active].map(row => [row.id, row])).values()];
}

/** One cached wire size per row; dependencies are admitted atomically with their candidate. */
export function snapshotEntities(normal: Partial<Snapshot>, active: Partial<Snapshot>): SnapshotEntity[] {
  const entities: SnapshotEntity[] = [];
  function add<T extends Row>(group: Group, rows: T[], time: (row: T) => string, tier: (row: T) => number, dependencies: (row: T) => string[]) {
    for (const row of rows) entities.push({ key: key(group, row.id), group, row, time: time(row), tier: tier(row), bytes: Buffer.byteLength(safeJson(row)), dependencies: dependencies(row) });
  }
  const owner = (id: string) => key('sessions', id);
  add('repositories', merged(normal.repositories, active.repositories), () => '', () => 5, () => []);
  add('sessions', merged(normal.sessions, active.sessions), row => row.startedAt, row => activeSession(row.status) ? 2 : 4,
    row => [key('repositories', row.repositoryId), ...(row.parentSessionId ? [owner(row.parentSessionId)] : [])]);
  add('requests', merged(normal.requests, active.requests), row => row.createdAt, row => actionable(row) ? 1 : 3, row => [owner(row.sessionId)]);
  add('questions', merged(normal.questions, active.questions), row => row.createdAt, row => row.status === 'open' ? 1 : 3, row => [owner(row.sessionId)]);
  add('messages', merged(normal.messages, active.messages), row => row.sentAt, row => row.status !== 'read' ? 2 : 3, row => [owner(row.fromSessionId), owner(row.toSessionId)]);
  add('jobs', merged(normal.jobs, active.jobs), row => row.startedAt, row => row.status === 'running' ? 2 : 3, row => [owner(row.sessionId)]);
  add('resets', merged(normal.resets, active.resets), row => row.at, () => 3, row => [owner(row.sessionId)]);
  return entities;
}

/** Priority, newest timestamp, then stable collection/id order; final arrays retain their usual display order. */
export const candidateOrder = (a: SnapshotEntity, b: SnapshotEntity): number =>
  a.tier - b.tier || compareText(b.time, a.time) || compareText(a.group, b.group) || compareText(a.row.id, b.row.id);

export const displayOrder = (a: SnapshotEntity, b: SnapshotEntity): number => {
  const order = compareText(a.time, b.time) || compareText(a.row.id, b.row.id);
  return a.group === 'resets' ? -order : order;
};

/** Iterative closure also tolerates cyclic parent metadata, without duplicating a dependency's cost. */
export function bundle(entity: SnapshotEntity, entities: Map<string, SnapshotEntity>, held: Set<string>): SnapshotEntity[] {
  const pending = [entity];
  const added = new Map<string, SnapshotEntity>();
  while (pending.length) {
    const next = pending.pop();
    if (!next || held.has(next.key) || added.has(next.key)) continue;
    added.set(next.key, next);
    for (const dependency of next.dependencies) {
      const row = entities.get(dependency);
      if (row) pending.push(row);
    }
  }
  return [...added.values()];
}
