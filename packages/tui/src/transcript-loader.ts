import type { Transcript, TranscriptEntry } from '@pi-console/contract';
import type { DaemonClient, TranscriptQuery } from './api/client.ts';
import type { Store } from './store/store.ts';
import type { TranscriptLoad, TranscriptProgress } from './store/transcript-history.ts';

interface VisibleTranscript { id: string; controller: AbortController; page?: AbortController; focus?: string }
const pageOrders: Record<TranscriptLoad, 'asc' | 'desc'> = { older: 'desc', newer: 'asc', around: 'asc', tail: 'asc' };

function pageAvailable(progress: TranscriptProgress | undefined, direction: TranscriptLoad): boolean {
  if (direction === 'older') return progress?.older === true;
  if (direction === 'newer') return progress?.newer === true;
  return true;
}

function pendingDirection(progress: TranscriptProgress | undefined, requested?: TranscriptLoad): TranscriptLoad | undefined {
  if (progress?.loading) return undefined;
  const direction = requested ?? progress?.error;
  return direction && pageAvailable(progress, direction) ? direction : undefined;
}

function publishIfActive(signal: AbortSignal, publish: () => void): void {
  if (!signal.aborted) publish();
}

function abortVisible(visible: VisibleTranscript): void {
  visible.controller.abort();
  visible.page?.abort();
}

function beginPage(visible: VisibleTranscript): AbortSignal {
  visible.page?.abort();
  const controller = new AbortController();
  visible.page = controller;
  return AbortSignal.any([controller.signal, visible.controller.signal]);
}

function pageCursor(entries: readonly TranscriptEntry[], direction: TranscriptLoad): number | undefined {
  return direction === 'older' ? entries[0]?.cursor : entries.at(-1)?.cursor;
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
    this.store.resetTranscript(id);
    this.store.setTranscriptProgress(id, { returnToLive: false, observedTail: 0 });
    this.requestDetail(visible);
    this.request(visible, entryId ? 'around' : 'tail');
    return () => { abortVisible(visible); };
  };

  focus = (id: string, entryId: string): void => {
    const visible = this.visibleSession(id);
    if (!visible) return;
    if (this.focusing(visible, entryId)) return;
    visible.focus = entryId;
    this.request(visible, 'around');
  };

  page = (id: string, direction?: TranscriptLoad): void => {
    const visible = this.visibleSession(id);
    if (!visible) return;
    const progress = this.store.getSnapshot().transcriptHistory.get(id);
    const load = pendingDirection(progress, direction);
    if (!load) return;
    this.store.setTranscriptProgress(id, { returnToLive: load === 'tail' });
    this.request(visible, load);
  };

  private visibleSession(id: string): VisibleTranscript | undefined {
    if (this.active?.id !== id) return undefined;
    return this.active.controller.signal.aborted ? undefined : this.active;
  }

  private focusing(visible: VisibleTranscript, entryId: string): boolean {
    const progress = this.store.getSnapshot().transcriptHistory.get(visible.id);
    return visible.focus === entryId && progress?.loading === 'around';
  }

  private requestDetail(visible: VisibleTranscript): void {
    const { signal } = visible.controller;
    void this.client.session(visible.id, signal).then(detail => {
      publishIfActive(signal, () => { this.store.mergeDetail(detail); });
    }, () => undefined);
  }

  private request(visible: VisibleTranscript, direction: TranscriptLoad): void {
    const signal = beginPage(visible);
    if (signal.aborted) return;
    this.store.setTranscriptProgress(visible.id, { loading: direction, error: undefined });
    void this.fetch(visible, direction, signal).then(page => {
      publishIfActive(signal, () => { this.store.setTranscriptPage(visible.id, page, direction); });
    }, () => {
      publishIfActive(signal, () => { this.requestFailed(visible, direction); });
    });
  }

  private requestFailed(visible: VisibleTranscript, direction: TranscriptLoad): void {
    if (this.needsTailFallback(visible, direction)) {
      visible.focus = undefined;
      this.request(visible, 'tail');
      return;
    }
    this.store.setTranscriptProgress(visible.id, { loading: undefined, error: direction });
  }

  private needsTailFallback(visible: VisibleTranscript, direction: TranscriptLoad): boolean {
    const entries = this.store.getSnapshot().transcripts.get(visible.id) ?? [];
    return direction === 'around' && entries.length === 0;
  }

  private async fetch(visible: VisibleTranscript, direction: TranscriptLoad, signal: AbortSignal): Promise<Transcript> {
    return direction === 'tail' ? this.tailPage(visible, signal) : this.client.transcriptPage(this.pageQuery(visible, direction, signal));
  }

  private async tailPage(visible: VisibleTranscript, signal: AbortSignal): Promise<Transcript> {
    const tail = await this.client.transcriptTail({ sessionId: visible.id, signal });
    return { items: tail.entries, nextCursor: tail.nextCursor ?? 0, hasMore: tail.hasMore === true };
  }

  private pageQuery(visible: VisibleTranscript, direction: TranscriptLoad, signal: AbortSignal): TranscriptQuery {
    const entries = this.store.getSnapshot().transcripts.get(visible.id) ?? [];
    return { sessionId: visible.id, signal, after: pageCursor(entries, direction), order: pageOrders[direction], around: direction === 'around' ? visible.focus : undefined };
  }

  stop(): void {
    if (this.active) abortVisible(this.active);
    this.active = undefined;
  }
}
