import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { readTranscriptFrames, transcriptEntry, transcriptUnavailable, type Scanner } from '@pi-console/adapters';
import type { Transcript, TranscriptEntry } from '@pi-console/contract';
import { HttpError } from '../security/guard.ts';
import type { TranscriptReader } from './transcripts.ts';
import type { TranscriptSources, TranscriptSource } from './transcript-sources.ts';

const empty = (after: number): Transcript => ({ items: [], nextCursor: after, hasMore: false });
const pageOf = (items: TranscriptEntry[], after: number, hasMore: boolean): Transcript => ({ items, nextCursor: items.at(-1)?.cursor ?? after, hasMore });

/** Two active scans, eight waiters. The queue holds no source handles or transcript bodies. */
class Scans {
  #active = 0;
  #closed = false;
  #pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  #drained: (() => void) | undefined;

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new HttpError(503, 'Transcript unavailable');
    if (this.#active >= 2) {
      if (this.#pending.length >= 8) throw new HttpError(503, 'Transcript unavailable');
      await new Promise<void>((resolve, reject) => { this.#pending.push({ resolve, reject }); });
    } else this.#active++;
    try { return await work(); }
    finally {
      const next = this.#pending.shift();
      if (next) next.resolve();
      else this.#active--;
      if (this.#active === 0) this.#drained?.();
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const pending of this.#pending.splice(0)) pending.reject(new HttpError(503, 'Transcript unavailable'));
    if (this.#active > 0) await new Promise<void>(resolve => { this.#drained = resolve; });
  }
}

/** On-demand bounded history. Only byte-offset hints survive requests; every body is re-read and redacted. */
export class FileTranscriptReader implements TranscriptReader {
  readonly #sources: TranscriptSources;
  readonly #scanner: Scanner | undefined;
  readonly #scans = new Scans();
  readonly #hints = new Map<string, number>();

  constructor(sources: TranscriptSources, scanner?: Scanner) {
    this.#sources = sources;
    this.#scanner = scanner;
  }

  page(sessionId: string, after: number, limit: number, order: 'asc' | 'desc' = 'asc'): Promise<Transcript> {
    return this.#read(sessionId, empty(after), async source => {
      const items: TranscriptEntry[] = [];
      const reverse = order === 'desc';
      const start = reverse ? Math.max(0, after - 1) : after;
      for await (const item of this.#entries(source, sessionId, { start, seekAfter: true, reverse })) {
        if (reverse && item.cursor >= after) continue;
        if (items.length === limit) return pageOf(items, after, true);
        items.push(item);
      }
      return pageOf(items, after, false);
    });
  }

  around(sessionId: string, entryId: string, limit: number): Promise<Transcript | undefined> {
    return this.#read(sessionId, undefined, async source => {
      const key = JSON.stringify([source.epoch, entryId, limit]);
      const start = this.#hints.get(key) ?? 0;
      const before: TranscriptEntry[] = [];
      const following: TranscriptEntry[] = [];
      let found = false;
      for await (const item of this.#entries(source, sessionId, { start })) {
        if (item.id === entryId) found = true;
        if (found) following.push(item);
        else {
          before.push(item);
          if (before.length >= limit) before.shift();
        }
        const preceding = Math.min(before.length, Math.floor((limit - 1) / 2));
        if (found && following.length > limit - preceding) break;
      }
      if (!found) { this.#hints.delete(key); return undefined; }
      const first = before.at(0) ?? following.at(0);
      if (first) this.#remember(key, first.cursor - 1);
      const preceding = Math.min(before.length, Math.max(Math.floor((limit - 1) / 2), limit - following.length));
      const items = [...before.slice(before.length - preceding), ...following].slice(0, limit);
      const hasOlder = await this.#hasOlder(source, sessionId, items[0]);
      return { ...pageOf(items, 0, following.length > limit - preceding), hasOlder };
    });
  }

  async #read<T>(sessionId: string, unavailable: T, work: (source: TranscriptSource) => Promise<T>): Promise<T> {
    return this.#scans.run(async () => {
      try {
        const source = await this.#sources.resolve(sessionId);
        return source ? await work(source) : unavailable;
      } catch (error) {
        if (transcriptUnavailable(error)) return unavailable;
        throw error;
      }
    });
  }

  async #hasOlder(source: TranscriptSource, sessionId: string, first?: TranscriptEntry): Promise<boolean> {
    if (!first) return false;
    const entries = this.#entries(source, sessionId, { start: first.cursor - 1, reverse: true });
    return (await entries.next()).done !== true;
  }

  async *#entries(source: TranscriptSource, sessionId: string, { start = 0, seekAfter = false, reverse = false }: { start?: number; seekAfter?: boolean; reverse?: boolean } = {}): AsyncGenerator<TranscriptEntry> {
    let offset = reverse ? Math.min(start, source.version.size) : start;
    do {
      const page = await readTranscriptFrames({ path: source.path, roots: [], resolvedRoots: source.roots, expected: source.version,
        offset, seekAfter, reverse, endOffset: source.version.size, scanner: this.#scanner });
      for (const frame of page.entries) {
        const entry = transcriptEntry(frame.value, sessionId, frame.start);
        if (entry) yield entry;
      }
      if (reverse ? page.nextOffset >= offset : page.nextOffset <= offset) return;
      offset = page.nextOffset;
      seekAfter = false;
      await yieldToLoop();
    } while (reverse ? offset > 0 : offset < source.version.size);
  }

  #remember(key: string, offset: number): void {
    this.#hints.delete(key);
    this.#hints.set(key, offset);
    const oldest = this.#hints.keys().next().value;
    if (this.#hints.size > 32 && oldest !== undefined) this.#hints.delete(oldest);
  }

  async close(): Promise<void> {
    await this.#scans.close();
    this.#hints.clear();
  }
}
