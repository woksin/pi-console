import type { DaemonClient } from './api/client.ts';
import type { Store } from './store/store.ts';

/** Only the visible session owns a backfill. Cleanup also guards clients that finish after abort. */
export class TranscriptLoader {
  private active: AbortController | undefined;
  private readonly store: Store;
  private readonly client: DaemonClient;

  constructor(store: Store, client: DaemonClient) {
    this.store = store;
    this.client = client;
  }

  load = (id: string): (() => void) => {
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const { signal } = controller;
    void this.client.session(id, signal).then(detail => { if (!signal.aborted) this.store.mergeDetail(detail); }, () => undefined);
    void this.client.transcriptTail({ sessionId: id, signal }).then(result => {
      if (!signal.aborted) this.store.mergeTranscript(id, result.entries, result.truncated);
    }, () => { if (!signal.aborted) this.store.mergeTranscript(id, []); });
    return () => { controller.abort(); };
  };

  stop(): void {
    this.active?.abort();
  }
}
