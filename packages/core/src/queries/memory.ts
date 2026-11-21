import type { MemoryItem, SessionMemory } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import { compareText } from '../projector/canonical.ts';
import type { ReadModels } from '../projections/index.ts';
import type { MemoryItemModel, MemoryItemStatus } from '../projections/memory.ts';
import type { Entry } from './paging.ts';

export const memoryStatuses: readonly MemoryItemStatus[] = ['active', 'proposed', 'done', 'superseded', 'withdrawn', 'rejected'];
export const unlinkedMemory = 'unlinked';

/** The console shows this string; a human runs it in a pi TUI. It is never executed here. */
export const confirmCommand = (id: string): string => `/memory confirm ${id}`;

/** A session item is scoped to its session, any other item belongs to the session of the message it cites, if that message is known. */
export function memorySessionOf(models: ReadModels, row: MemoryItemModel): string | null {
  if (row.scopeKind === 'session') return row.scopeKey;
  const source = row.sourceMessageId !== null && Object.hasOwn(models.memory.messages, row.sourceMessageId) ? models.memory.messages[row.sourceMessageId] : undefined;
  return source?.recorded && source.sessionId !== '' ? source.sessionId : null;
}

export function toMemoryItem(models: ReadModels, row: MemoryItemModel): MemoryItem {
  return {
    id: row.id, kind: row.kind, scope: { kind: row.scopeKind, key: row.scopeKey }, sessionId: memorySessionOf(models, row),
    status: row.status, statusBasis: row.statusBasis, text: row.excerpt, withheld: row.withheld, sourceType: row.sourceType,
    sourceMessageId: row.sourceMessageId, at: row.at, command: row.status === 'proposed' ? confirmCommand(row.id) : null,
  };
}

const recorded = (models: ReadModels): MemoryItemModel[] => Object.values(models.memory.items).filter(row => row.recorded);

export function memoryEntries(models: ReadModels, status?: MemoryItemStatus): Entry<MemoryItem>[] {
  return recorded(models).filter(row => status === undefined || row.status === status)
    .map(row => ({ key: row.at, id: row.id, active: row.status === 'proposed', build: () => toMemoryItem(models, row) }));
}

const live = (row: MemoryItemModel) => row.status === 'active' || row.status === 'proposed';

/** A store is detected once any memory fact has been ingested. */
const detected = (models: ReadModels) => Object.keys(models.memory.items).length > 0 || Object.keys(models.memory.messages).length > 0;

/**
 * Per-session summary. The unresolved figure is a lower bound: human messages that no classification and no item cites.
 * The exact count needs message text, which the console never ingests (docs/api/v1.md).
 */
export function sessionMemory(models: ReadModels, sessionId: string): SessionMemory {
  const items = recorded(models);
  const counts = Object.fromEntries(memoryStatuses.map(status => [status, 0])) as SessionMemory['counts'];
  for (const row of items) if (memorySessionOf(models, row) === sessionId) counts[row.status]++;
  const lowerBound = Object.values(models.memory.messages)
    .filter(message => message.recorded && message.sessionId === sessionId && message.origin === 'human' && !message.classified && message.itemIds.length === 0).length;
  const confirmable = items.filter(row => row.status === 'proposed' && row.statusBasis === 'recorded' && memorySessionOf(models, row) === sessionId).length;
  const wider = items.filter(row => live(row) && memorySessionOf(models, row) === null).length;
  return {
    sessionId, storeDetected: detected(models), counts, proposedConfirmable: confirmable,
    unresolved: { lowerBound, atLastHandoff: null }, wider, handoffs: [],
  };
}

function proposedText(rows: MemoryItemModel[]): string {
  return rows.length === 1 ? `1 proposed memory item waiting for ${confirmCommand(rows[0].id)}` : `${rows.length} proposed memory items waiting for /memory confirm`;
}

/** One attention item per session holding recorded-proposed items, plus `memory:unlinked` for those without a session. */
export function proposedMemoryAttention(models: ReadModels): AttentionItem[] {
  const groups = new Map<string, MemoryItemModel[]>();
  for (const row of recorded(models).filter(item => item.status === 'proposed' && item.statusBasis === 'recorded')) {
    const key = memorySessionOf(models, row) ?? unlinkedMemory;
    groups.set(key, [...groups.get(key) ?? [], row]);
  }
  return [...groups].map(([key, rows]) => {
    const since = rows.map(row => row.at).sort(compareText)[0];
    return {
      id: `memory:${key}`, reason: 'proposed-memory', sessionId: key === unlinkedMemory ? null : key, laneId: null,
      text: proposedText(rows.sort((a, b) => compareText(a.id, b.id))), since, pointer: null,
    };
  });
}
