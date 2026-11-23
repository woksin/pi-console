import { defaultStaleMs, staleItem, type AttentionItem } from '../attention/needs-you.ts';
import type { ReadModels } from '../projections/index.ts';
import { KeyedQueue, rowOf } from './keyed-queue.ts';

/** Per-item comparisons preserve attention-only changes without serializing an owner's history. */
export class IncrementalAttention {
  readonly sessions = new Set<string>();
  readonly #items = new Map<string, { owner: string | null; token: string }>();
  readonly #counts = new Map<string, number>();
  readonly #deadlines = new KeyedQueue();
  #now = -Infinity;

  set(key: string, item: AttentionItem | null, changed: Set<string>): void {
    const old = this.#items.get(key);
    const token = JSON.stringify(item);
    if (old?.token === token) return;
    this.#changeOwner(old?.owner, -1, changed);
    this.#items.delete(key);
    if (!item) return;
    this.#items.set(key, { owner: item.sessionId, token });
    this.#changeOwner(item.sessionId, 1, changed);
  }

  session(models: ReadModels, id: string, now: Date, changed: Set<string>): void {
    const row = rowOf(models.sessions.sessions, id);
    this.#deadlines.delete(id);
    this.set(`session:${id}`, row ? staleItem(row, { now }) : null, changed);
    if (row?.endedAt === null && row.openTurnId !== null) {
      const deadline = new Date(new Date(row.updatedAt).getTime() + defaultStaleMs).toISOString();
      if (deadline >= now.toISOString()) this.#deadlines.set({ id, key: deadline });
    }
  }

  advance(models: ReadModels, now: Date, changed: Set<string>): void {
    if (now.getTime() < this.#now) {
      // Explicit clock rollback is a rare rebase, not the ordinary flush path.
      for (const id of Object.keys(models.sessions.sessions)) this.session(models, id, now, changed);
    }
    this.#now = now.getTime();
    const cutoff = now.toISOString();
    while (this.#deadlines.first && this.#deadlines.first.key < cutoff) {
      this.session(models, this.#deadlines.first.id, now, changed);
    }
  }

  #changeOwner(owner: string | null | undefined, delta: number, changed: Set<string>): void {
    if (owner === null || owner === undefined) return;
    this.#count(owner, delta);
    changed.add(owner);
  }

  #count(id: string, delta: number): void {
    const count = (this.#counts.get(id) ?? 0) + delta;
    if (count === 0) { this.#counts.delete(id); this.sessions.delete(id); }
    else { this.#counts.set(id, count); this.sessions.add(id); }
  }
}
