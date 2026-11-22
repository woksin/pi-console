import type { MemoryItem, MemoryItemPage, SessionMemory } from '@pi-console/contract';
import type { DaemonClient } from './api/client.ts';
import type { Store, MemoryHistory } from './store/store.ts';

type Operation = 'refresh' | 'more';
type SessionId = SessionMemory['sessionId'];
type Cursor = MemoryItemPage['nextCursor'];
const emptyHistory: MemoryHistory = { cursor: null, more: true, loading: false };
const mergeItems = (older: readonly MemoryItem[], newer: readonly MemoryItem[]) => [...new Map([...older, ...newer].map(item => [item.id, item])).values()];

/** Serializes refresh/backfill per session and keeps the loaded window canonical after reviews. */
export class MemoryLoader {
  #pending = new Map<string, Promise<void>>();
  #stopped = false;
  private readonly store: Store;
  private readonly client: Pick<DaemonClient, 'sessionMemory' | 'memoryPage'>;
  constructor(store: Store, client: Pick<DaemonClient, 'sessionMemory' | 'memoryPage'>) {
    this.store = store; this.client = client;
  }

  async refresh(id: SessionId): Promise<void> {
    const pending = this.#pending.get(id);
    if (pending) await pending.catch(() => undefined);
    if (this.#stopped) return;
    return this.#load(id, 'refresh');
  }

  readonly more = async (id: SessionId): Promise<void> => {
    const progress = this.store.getSnapshot().memoryHistory.get(id);
    if (this.#pending.has(id) || !progress) return;
    if (progress.error === 'refresh') { await this.refresh(id).catch(() => undefined); return; }
    if (!progress.more || !progress.cursor) return;
    await this.#load(id, 'more').catch(() => undefined);
  };

  stop(): void { this.#stopped = true; }

  #load(id: SessionId, operation: Operation): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    const pending = this.#pending.get(id);
    if (pending) return pending;
    const progress = this.store.getSnapshot().memoryHistory.get(id) ?? emptyHistory;
    this.store.setMemoryHistory(id, { ...progress, loading: true, error: undefined });
    const loading = this.#fetch(id, operation, progress).finally(() => { this.#pending.delete(id); });
    this.#pending.set(id, loading);
    return loading;
  }

  async #fetch(id: SessionId, operation: Operation, progress: MemoryHistory): Promise<void> {
    try {
      const page = operation === 'refresh' ? await this.#refresh(id) : await this.#append(id, progress.cursor);
      if (!this.#stopped) this.store.setMemoryHistory(id, { cursor: page.nextCursor, more: page.hasMore, total: page.total, loading: false });
    } catch (error) {
      if (!this.#stopped) this.store.setMemoryHistory(id, { ...progress, loading: false, error: operation });
      throw error;
    }
  }

  async #refresh(id: SessionId): Promise<MemoryItemPage> {
    const target = Math.max(100, this.store.getSnapshot().memoryItems.get(id)?.length ?? 0);
    const [summary, page] = await Promise.all([this.client.sessionMemory(id), this.#window(id, target)]);
    if (!this.#stopped) this.store.mergeMemory(id, summary, page.items);
    return page;
  }

  async #window(id: SessionId, target: number): Promise<MemoryItemPage> {
    let page = await this.#page(id, null);
    let items = page.items;
    while (page.hasMore && items.length < target) {
      if (this.#stopped) break;
      page = await this.#page(id, page.nextCursor);
      items = mergeItems(items, page.items);
    }
    return { ...page, items };
  }

  async #append(id: SessionId, cursor: Cursor): Promise<MemoryItemPage> {
    const page = await this.#page(id, cursor);
    const data = this.store.getSnapshot();
    const summary = data.memory.get(id);
    if (!this.#stopped && summary) this.store.mergeMemory(id, summary, mergeItems(data.memoryItems.get(id) ?? [], page.items));
    return page;
  }

  async #page(id: SessionId, cursor: Cursor): Promise<MemoryItemPage> {
    const page = await this.client.memoryPage(id, cursor);
    if (!page.hasMore) return page;
    if (!page.nextCursor) throw new Error('Memory page cursor did not advance');
    if (page.nextCursor === cursor) throw new Error('Memory page cursor did not advance');
    return page;
  }
}
