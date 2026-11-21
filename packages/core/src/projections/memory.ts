import type { EventEnvelope, EventPayloads } from '@pi-console/contract';
import { entry, insertSorted, markDirty, orderKey, projection } from '../projector/handlers.ts';

export type MemoryItemStatus = 'active' | 'proposed' | 'done' | 'superseded' | 'withdrawn' | 'rejected';
export type MemoryItemKind = EventPayloads['MemoryItemRecorded']['kind'];
export type MemoryOrigin = EventPayloads['MemoryMessageRecorded']['origin'];

/** A status change keyed by its event's order, so replay in any arrival order folds to the same status. */
interface Transition { key: string; to: 'confirm' | Exclude<MemoryItemStatus, 'active' | 'proposed'> }

export interface MemoryItemModel {
  id: string;
  /** False while only later facts (a confirm, a retire, a superseding add) have been seen. */
  recorded: boolean;
  kind: MemoryItemKind;
  scopeKind: EventPayloads['MemoryItemRecorded']['scopeKind'];
  scopeKey: string;
  sourceType: EventPayloads['MemoryItemRecorded']['sourceType'];
  sourceMessageId: string | null;
  authorityMode: 'auto' | 'command' | 'none' | null;
  excerpt: string;
  withheld: boolean;
  at: string;
  status: MemoryItemStatus;
  /** `recorded`: the store says so (order, decision, no authority, non-human source, confirm, retire); `assumed`: the producer's rule engine decides. */
  statusBasis: 'recorded' | 'assumed';
  transitions: Transition[];
  stamps: Record<string, string>;
}

/** Journal message metadata; the text is never ingested. */
export interface MemoryMessageModel {
  id: string;
  recorded: boolean;
  sessionId: string;
  origin: MemoryOrigin;
  at: string;
  /** Some `classify` event named this message. */
  classified: boolean;
  /** Ids of items that cite this message as their source. */
  itemIds: string[];
  stamps: Record<string, string>;
}

/** Collections only: scalar fields beside them would not survive row-wise persistence. A store is detected once any row exists. */
export interface MemoryState {
  items: Record<string, MemoryItemModel>;
  messages: Record<string, MemoryMessageModel>;
}

const retired = new Set<string>(['done', 'superseded', 'withdrawn', 'rejected']);

function item(state: MemoryState, id: string): MemoryItemModel {
  markDirty(state, 'items', id);
  return entry(state.items, id, () => ({
    id, recorded: false, kind: 'directive', scopeKind: 'global', scopeKey: '', sourceType: 'user_message', sourceMessageId: null,
    authorityMode: null, excerpt: '', withheld: false, at: '', status: 'proposed', statusBasis: 'recorded', transitions: [],
    stamps: Object.create(null) as Record<string, string>,
  }));
}

function message(state: MemoryState, id: string): MemoryMessageModel {
  markDirty(state, 'messages', id);
  return entry(state.messages, id, () => ({
    id, recorded: false, sessionId: '', origin: 'human', at: '', classified: false, itemIds: [], stamps: Object.create(null) as Record<string, string>,
  }));
}

/** Last-writer-wins per field, ordered by `occurredAt` then id, independent of arrival order. */
function update(row: { stamps: Record<string, string> }, field: string, event: EventEnvelope, apply: () => void): void {
  const key = orderKey(event);
  if (key < (row.stamps[field] ?? '')) return;
  apply();
  row.stamps[field] = key;
}

type Initial = Pick<MemoryItemModel, 'status' | 'statusBasis'>;

/** Status when the add was recorded; the console cannot re-run the producer's eligibility rules, hence `assumed`. */
function initialStatus(row: MemoryItemModel, messages: MemoryState['messages']): Initial {
  if (row.kind === 'order') return { status: 'proposed', statusBasis: 'recorded' };
  if (row.kind === 'decision') return { status: 'active', statusBasis: 'recorded' };
  if (row.authorityMode === null || row.authorityMode === 'none') return { status: 'proposed', statusBasis: 'recorded' };
  const source = row.sourceMessageId === null || !Object.hasOwn(messages, row.sourceMessageId) ? undefined : messages[row.sourceMessageId];
  if (source?.recorded && source.origin !== 'human') return { status: 'proposed', statusBasis: 'recorded' };
  return { status: 'active', statusBasis: 'assumed' };
}

function foldTransition(current: Initial, transition: Transition): Initial {
  if (transition.to === 'confirm') return current.status === 'proposed' ? { status: 'active', statusBasis: 'recorded' } : current;
  return { status: transition.to, statusBasis: 'recorded' };
}

function derive(state: MemoryState, row: MemoryItemModel): void {
  markDirty(state, 'items', row.id);
  Object.assign(row, row.transitions.reduce(foldTransition, initialStatus(row, state.messages)));
}

function transit(state: MemoryState, id: string, transition: Transition): void {
  const row = item(state, id);
  if (row.transitions.some(existing => existing.key === transition.key && existing.to === transition.to)) return;
  insertSorted(row.transitions, transition, existing => existing.key);
  derive(state, row);
}

function link(state: MemoryState, row: MemoryItemModel, messageId: string | null): void {
  if (messageId === null) return;
  const source = message(state, messageId);
  if (!source.itemIds.includes(row.id)) source.itemIds.push(row.id);
}

function recordItem(state: MemoryState, payload: EventPayloads['MemoryItemRecorded'], event: EventEnvelope): void {
  const row = item(state, payload.itemId);
  update(row, 'add', event, () => {
    Object.assign(row, {
      recorded: true, kind: payload.kind, scopeKind: payload.scopeKind, scopeKey: payload.scopeKey, sourceType: payload.sourceType,
      sourceMessageId: payload.sourceMessageId, authorityMode: payload.authorityMode, excerpt: payload.excerpt,
      withheld: payload.withheld, at: event.occurredAt,
    });
  });
  link(state, row, row.sourceMessageId);
  derive(state, row);
  for (const target of payload.supersedes) transit(state, target, { key: orderKey(event), to: 'superseded' });
}

function recordMessage(state: MemoryState, payload: EventPayloads['MemoryMessageRecorded'], event: EventEnvelope): void {
  const row = message(state, payload.messageId);
  update(row, 'recorded', event, () => {
    Object.assign(row, { recorded: true, sessionId: payload.sessionId, origin: payload.origin, at: event.occurredAt });
  });
  for (const id of row.itemIds) derive(state, item(state, id));
}

/** Intent memory as the producer recorded it (read-only, ADR-0008). Journal text never reaches this state. */
export const memoryProjection = projection<MemoryState>('memory', 1, () => ({ items: {}, messages: {} }), {
  MemoryItemRecorded(state, payload, event) {
    recordItem(state, payload, event);
  },
  MemoryItemConfirmed(state, payload, event) {
    transit(state, payload.itemId, { key: orderKey(event), to: 'confirm' });
  },
  MemoryItemRetired(state, payload, event) {
    if (retired.has(payload.status)) transit(state, payload.itemId, { key: orderKey(event), to: payload.status });
  },
  MemoryMessageRecorded(state, payload, event) {
    recordMessage(state, payload, event);
  },
  MemoryMessageClassified(state, payload) {
    message(state, payload.messageId).classified = true;
  },
}, ['items', 'messages']);
