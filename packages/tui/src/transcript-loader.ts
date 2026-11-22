import type { Transcript } from '@pi-console/contract';
import type { DaemonClient } from './api/client.ts';
import type { Store } from './store/store.ts';
import type { TranscriptLoad, TranscriptProgress } from './store/transcript-history.ts';

interface VisibleTranscript { id: string; controller: AbortController; page?: AbortController; focus?: string }

function pageAvailable(progress: TranscriptProgress | undefined, direction: TranscriptLoad): boolean {
  if (direction === 'older') return progress?.older === true;
  if (direction === 'newer') return progress?.newer === true;
  return true;
}

/** Only the visible session owns requests. Every page has its own cancellable generation. */
export class TranscriptLoader {
  private active: VisibleTranscript | undefined;
  private readonly store: Store;
  private readonly client: DaemonClient;

  constructor(store: Store, client: DaemonClient) {
    this.store = store;
    this.client = client;
  }

  load = (id: string, entryId?: string): (() => void) => {
    this.stop();
    const visible: VisibleTranscript = { id, controller: new AbortController(), focus: entryId };
    this.active = visible;
    this.store.setTranscriptProgress(id, { returnToLive: false, observedTail: 0 });
    const { signal } = visible.controller;
    void this.client.session(id, signal).then(detail => { if (!signal.aborted) this.store.mergeDetail(detail); }, () => undefined);
    this.request(visible, entryId ? 'around' : 'tail');
    return () => { visible.controller.abort(); visible.page?.abort(); };
  };

  focus = (id: string, entryId: string): void => {
    const visible = this.visibleSession(id);
    if (!visible) return;
    if (visible.focus === entryId) return;
    visible.focus = entryId;
    this.request(visible, 'around');
  };

  page = (id: string, direction?: TranscriptLoad): void => {
    const visible = this.visibleSession(id);
    if (!visible) return;
    const progress = this.store.getSnapshot().transcriptHistory.get(id);
    if (progress?.loading) return;
    const load = direction ?? progress?.error;
    if (!load || !pageAvailable(progress, load)) return;
    this.store.setTranscriptProgress(id, { returnToLive: load === 'tail' });
    this.request(visible, load);
  };

  private visibleSession(id: string): VisibleTranscript | undefined {
    if (this.active?.id !== id) return undefined;
    return this.active.controller.signal.aborted ? undefined : this.active;
  }

  private request(visible: VisibleTranscript, direction: TranscriptLoad): void {
    visible.page?.abort();
    const controller = new AbortController();
    visible.page = controller;
    const signal = AbortSignal.any([controller.signal, visible.controller.signal]);
    if (signal.aborted) return;
    this.store.setTranscriptProgress(visible.id, { loading: direction, error: undefined });
    void this.fetch(visible, direction, signal).then(page => {
      if (!signal.aborted) this.store.setTranscriptPage(visible.id, page, direction);
    }, () => {
      if (!signal.aborted) this.store.setTranscriptProgress(visible.id, { loading: undefined, error: direction });
    });
  }

  private async fetch(visible: VisibleTranscript, direction: TranscriptLoad, signal: AbortSignal): Promise<Transcript> {
    const sessionId = visible.id;
    if (direction === 'tail') {
      const tail = await this.client.transcriptTail({ sessionId, signal });
      return { items: tail.entries, nextCursor: tail.nextCursor ?? 0, hasMore: tail.hasMore === true };
    }
    const entries = this.store.getSnapshot().transcripts.get(sessionId) ?? [];
    const after = direction === 'older' ? entries[0]?.cursor : entries.at(-1)?.cursor;
    return this.client.transcriptPage({ sessionId, signal, after, order: direction === 'older' ? 'desc' : 'asc', around: direction === 'around' ? visible.focus : undefined });
  }

  stop(): void {
    this.active?.controller.abort();
    this.active?.page?.abort();
    this.active = undefined;
  }
}
