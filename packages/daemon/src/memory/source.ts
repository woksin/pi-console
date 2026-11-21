import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { EventEnvelope } from '@pi-console/contract';
import type { DaemonConfig } from '../config.ts';

/** Only IDs and source identity; no second copy of item content. Ambiguous IDs fail closed. */
export class ReviewSource {
  readonly #config: DaemonConfig;
  readonly #items = new Map<string, string | null>();
  constructor(config: DaemonConfig) { this.#config = config; }
  store(): { id: string; events: string } | undefined {
    try {
      if (!this.#config.sources['intent-memory']) return undefined;
      const memory = join(realpathSync(this.#config.agentRoot), 'memory');
      const stat = lstatSync(memory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
      const canonical = realpathSync(memory);
      return { id: createHash('sha256').update(canonical).digest('hex'), events: join(canonical, 'events.jsonl') };
    } catch { return undefined; }
  }
  observe(event: EventEnvelope): void {
    if (event.source !== 'intent-memory' || event.type !== 'MemoryItemRecorded') return;
    const { itemId } = event.payload as { itemId: string };
    const file = event.refs?.file ?? null;
    const prior = this.#items.get(itemId);
    this.#items.set(itemId, prior === undefined || prior === file ? file : null);
  }
  owns(itemId: string): boolean {
    const store = this.store();
    return store !== undefined && this.#items.get(itemId) === store.events;
  }
}
