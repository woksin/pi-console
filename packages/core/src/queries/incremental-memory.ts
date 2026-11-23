import type { SessionMemory } from '@pi-console/contract';
import type { AttentionItem } from '../attention/needs-you.ts';
import type { ReadModels } from '../projections/index.ts';
import type { MemoryItemStatus, MemoryItemModel, MemoryMessageModel } from '../projections/memory.ts';
import { KeyedQueue, Owners, rowOf } from './keyed-queue.ts';
import { memorySessionOf, memoryStatuses, memorySummary, proposedMemoryItem, toMemoryItem, unlinkedMemory } from './memory.ts';

interface ItemContribution { owner: string; status?: MemoryItemStatus; proposed: boolean; token?: string; at: string }
interface MessageContribution { owner: string; unresolved: number }
interface Group { counts: SessionMemory['counts']; proposed: KeyedQueue; unresolved: number }
const group = (): Group => ({ counts: Object.fromEntries(memoryStatuses.map(status => [status, 0])) as SessionMemory['counts'], proposed: new KeyedQueue(), unresolved: 0 });

function itemContribution(models: ReadModels, row: MemoryItemModel | undefined): ItemContribution | undefined {
  if (!row) return undefined;
  return {
    owner: memorySessionOf(models, row) ?? unlinkedMemory, status: row.recorded ? row.status : undefined,
    proposed: row.recorded && row.status === 'proposed' && row.statusBasis === 'recorded',
    token: row.recorded ? JSON.stringify(toMemoryItem(models, row)) : undefined, at: row.at,
  };
}

function messageContribution(row: MemoryMessageModel | undefined): MessageContribution | undefined {
  if (!row) return undefined;
  return { owner: row.sessionId, unresolved: Number(row.recorded && row.origin === 'human' && !row.classified && row.itemIds.length === 0) };
}

function markOwners(old: { owner: string } | undefined, next: { owner: string } | undefined, changed: Set<string>): void {
  if (old) changed.add(old.owner);
  if (next) changed.add(next.owner);
}

const unresolvedOwner = (row: MessageContribution | undefined): MessageContribution | undefined => row?.unresolved ? row : undefined;
const sameMessage = (old: MessageContribution | undefined, next: MessageContribution | undefined): boolean => old?.owner === next?.owner && old?.unresolved === next?.unresolved;
const isWider = (row: ItemContribution): boolean => row.owner === unlinkedMemory && ['active', 'proposed'].includes(row.status ?? '');

/** Row contributions and reverse source links: no per-session filtering of the global memory store. */
export class IncrementalMemory {
  readonly sources = new Owners();
  readonly #items = new Map<string, ItemContribution>();
  readonly #messages = new Map<string, MessageContribution>();
  readonly #groups = new Map<string, Group>();
  #wider = 0;

  get detected(): boolean { return this.#items.size + this.#messages.size > 0; }
  get wider(): number { return this.#wider; }

  item(models: ReadModels, id: string, changed: Set<string>, attention: Set<string>): void {
    const old = this.#items.get(id);
    const row = rowOf(models.memory.items, id);
    const next = itemContribution(models, row);
    this.#setItem(id, next);
    this.sources.set(id, row?.sourceMessageId);
    if (old?.token === next?.token) return;
    markOwners(old, next, changed);
    markOwners(old, next, attention);
  }

  message(models: ReadModels, id: string, changed: Set<string>): void {
    const old = this.#messages.get(id);
    const next = messageContribution(rowOf(models.memory.messages, id));
    this.#setMessage(id, next);
    if (sameMessage(old, next)) return;
    markOwners(unresolvedOwner(old), unresolvedOwner(next), changed);
  }

  summary(id: string): SessionMemory {
    const row = this.#group(id);
    return memorySummary(id, { ...row.counts }, row.proposed.size, row.unresolved, this.detected, this.#wider);
  }

  attention(owner: string): AttentionItem | null {
    const rows = this.#groups.get(owner)?.proposed;
    return rows?.first ? proposedMemoryItem(owner, rows.size, rows.first.id, rows.first.key) : null;
  }

  #setItem(id: string, next: ItemContribution | undefined): void {
    const old = this.#items.get(id);
    if (old) this.#contribute(id, old, -1);
    this.#items.delete(id);
    if (next) { this.#items.set(id, next); this.#contribute(id, next, 1); }
  }

  #setMessage(id: string, next: MessageContribution | undefined): void {
    const old = this.#messages.get(id);
    if (old) this.#group(old.owner).unresolved -= old.unresolved;
    this.#messages.delete(id);
    if (next) { this.#messages.set(id, next); this.#group(next.owner).unresolved += next.unresolved; }
  }

  #group(owner: string): Group {
    let row = this.#groups.get(owner);
    if (!row) { row = group(); this.#groups.set(owner, row); }
    return row;
  }

  #contribute(id: string, row: ItemContribution, delta: number): void {
    const target = this.#group(row.owner);
    if (row.status) target.counts[row.status] += delta;
    if (isWider(row)) this.#wider += delta;
    if (row.proposed && delta > 0) target.proposed.set({ id, key: row.at });
    else target.proposed.delete(id);
  }
}
