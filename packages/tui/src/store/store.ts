import { connectingState, type MemoryReviewSession, mergeHistory, mergeSnapshot, type Totals, type WindowedCollection } from '@pi-console/viewmodels';
import type { AttentionItem, Event, Graph, Job, MemoryItem, Message, Question, Request, Reset, Session, SessionDetail, SessionMemory, Transcript, TranscriptEntry } from '@pi-console/contract';

import { emptyProgress, transcriptPage, TRANSCRIPT_LIMIT, type TranscriptLoad, type TranscriptProgress } from './transcript-history.ts';
export { TRANSCRIPT_LIMIT } from './transcript-history.ts';
const upsert = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex(existing => existing.id === item.id);
  return index < 0 ? [...items, item] : items.map((existing, position) => (position === index ? item : existing));
};

export interface MemoryHistory { cursor: string | null; more: boolean; total?: number; loading: boolean; error?: 'refresh' | 'more' }

export interface Connection { connected: boolean; error: string; lastSeq: number | undefined; lastEventAt: number | undefined; eventsReceived: number }
export interface Data {
  loaded: boolean; connection: Connection; repositories: number;
  graph: Graph;
  /** The canonical graph has been read at least once; `graphError` is set while the latest read has failed (the last graph is kept). */
  graphLoaded: boolean; graphError: boolean;
  /** The daemon's own health record, flattened for Settings; `null` until the first read succeeds. */
  health: Record<string, unknown> | null;
  sessions: Session[]; requests: Request[]; questions: Question[]; messages: Message[]; jobs: Job[]; resets: Reset[];
  /** Full collection sizes from a bounded snapshot; `null` when the daemon sent complete lists. */
  totals: Totals | null; bounded: readonly WindowedCollection[];
  /** Paging progress per windowed collection once its history has been requested. */
  history: Partial<Record<WindowedCollection, { cursor: string | null; more: boolean; error?: boolean }>>;
  needsYou: AttentionItem[]; transcripts: ReadonlyMap<string, TranscriptEntry[]>;
  /** Sessions where backfill or live retention actually dropped older entries. */
  transcriptsTruncated: ReadonlySet<string>;
  transcriptHistory: ReadonlyMap<string, TranscriptProgress>;
  /** True after a successful attention fetch, until a fetch fails; `loaded` alone is too early. */
  needsYouLoaded: boolean; needsYouError: boolean;
  /** True after any successful attention fetch, including an empty list; retained across refresh failures. */
  needsYouCached: boolean;
  /** Read-only intent memory per session id, fetched when its session is opened. */
  memory: ReadonlyMap<string, SessionMemory>; memoryItems: ReadonlyMap<string, MemoryItem[]>;
  memoryReviews: ReadonlyMap<string, MemoryReviewSession>;
  /** Loaded memory history is separate from whole-session summary counts. */
  memoryHistory: ReadonlyMap<string, MemoryHistory>;
  /** Ids of entities touched since the last render, used for the brief "just changed" highlight. */
  fresh: ReadonlyMap<string, number>;
}

const emptyData = (): Data => ({
  loaded: false, connection: { connected: false, error: connectingState, lastSeq: undefined, lastEventAt: undefined, eventsReceived: 0 }, repositories: 0,
  graph: { nodes: [], edges: [] }, graphLoaded: false, graphError: false, health: null, sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], totals: null, bounded: [], history: {}, needsYou: [], needsYouLoaded: false, needsYouError: false, needsYouCached: false, transcripts: new Map(), transcriptsTruncated: new Set(), transcriptHistory: new Map(), memory: new Map(), memoryItems: new Map(), memoryReviews: new Map(), memoryHistory: new Map(), fresh: new Map(),
});

/**
 * Client-side mirror of the daemon's state. It only folds events into collections; attention, pairing and status are
 * the daemon's. Updates are coalesced so a stream of thousands of events renders at most ~20 times a second.
 */
export class Store {
  private data: Data = emptyData();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingTranscripts = new Map<string, TranscriptEntry[]>();
  private readonly pendingFresh = new Map<string, number>();
  private dirty = false;
  now: () => number = Date.now;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): Data => this.data;

  apply(event: Event): void {
    const connection = { ...this.data.connection, lastSeq: event.seq, lastEventAt: this.now(), eventsReceived: this.data.connection.eventsReceived + 1 };
    switch (event.type) {
      case 'snapshot': {
        const snapshot = event.payload;
        const bounded = snapshot.bounded ?? [];
        const list = <T extends { id: string }>(name: WindowedCollection, previous: T[], incoming: T[]): T[] => (bounded.includes(name) ? mergeSnapshot(name, previous, incoming) : incoming);
        this.data = {
          ...this.data, loaded: true, repositories: snapshot.repositories.length, resets: list('resets', this.data.resets, snapshot.resets), totals: snapshot.totals ?? null, bounded, history: {},
          sessions: list('sessions', this.data.sessions, snapshot.sessions), requests: list('requests', this.data.requests, snapshot.requests),
          questions: list('questions', this.data.questions, snapshot.questions), messages: list('messages', this.data.messages, snapshot.messages), jobs: list('jobs', this.data.jobs, snapshot.jobs),
        };
        break;
      }
      case 'session.updated': {
        const session = { ...event.payload };
        delete session.memoryChanged;
        this.data = { ...this.data, sessions: upsert(this.data.sessions, session) }; this.touch(session.id); break;
      }
      case 'request.observed': case 'request.interrupted': this.data = { ...this.data, requests: upsert(this.data.requests, event.payload) }; this.touch(event.payload.id); break;
      case 'question.asked': this.data = { ...this.data, questions: upsert(this.data.questions, event.payload) }; this.touch(event.payload.id); break;
      case 'message.sent': this.data = { ...this.data, messages: upsert(this.data.messages, event.payload) }; this.touch(event.payload.id); break;
      case 'job.updated': case 'job.finished': this.data = { ...this.data, jobs: upsert(this.data.jobs, event.payload) }; this.touch(event.payload.id); break;
      case 'reset.occurred': this.data = { ...this.data, resets: upsert(this.data.resets, event.payload) }; break;
      case 'transcript.appended': this.appendTranscript([event.payload]); break;
      case 'intervention.recorded': break;
    }
    this.data = { ...this.data, connection };
    this.schedule();
  }

  private touch(id: string): void {
    this.pendingFresh.set(id, this.now());
  }

  setMemoryReview(id: string, review: MemoryReviewSession): void {
    this.data = { ...this.data, memoryReviews: new Map(this.data.memoryReviews).set(id, review) };
    this.schedule();
  }

  setNeedsYouError(failed: boolean): void {
    this.data = { ...this.data, needsYouError: failed, needsYouLoaded: this.data.needsYouLoaded && !failed };
    this.schedule();
  }

  /** Forgets everything mirrored from the daemon: its history was reset, so the next snapshot replaces all of it. */
  reset(): void {
    this.pendingTranscripts.clear();
    this.pendingFresh.clear();
    this.data = emptyData();
    this.schedule();
  }

  setConnection(connected: boolean, error: string): void {
    this.data = { ...this.data, connection: { ...this.data.connection, connected, error } };
    this.schedule();
  }

  setGraph(graph: Graph): void { this.data = { ...this.data, graph, graphLoaded: true, graphError: false }; this.schedule(); }

  markGraphFailed(): void { this.data = { ...this.data, graphError: true }; this.schedule(); }

  setHealth(health: Record<string, unknown>): void { this.data = { ...this.data, health }; this.schedule(); }

  setNeedsYou(needsYou: AttentionItem[]): void {
    this.data = { ...this.data, needsYou, needsYouLoaded: true, needsYouError: false, needsYouCached: true };
    this.schedule();
  }

  /** Records a page failure without losing the cursor needed to retry it. */
  setHistoryError(collection: WindowedCollection, error: boolean): void {
    const progress = this.data.history[collection] ?? { cursor: null, more: true };
    this.data = { ...this.data, history: { ...this.data.history, [collection]: { ...progress, error } } };
    this.schedule();
  }

  /** Merges one history page of a windowed collection (rows already held win) and records the paging progress and total. */
  mergePage(collection: WindowedCollection, page: { items: readonly { id: string }[]; nextCursor: string | null; hasMore: boolean; total: number }): void {
    const merged = mergeHistory(this.data[collection] as { id: string }[], page.items);
    const totals = this.data.totals ? { ...this.data.totals, [collection]: page.total } : null;
    this.data = { ...this.data, [collection]: merged, totals, history: { ...this.data.history, [collection]: { cursor: page.nextCursor, more: page.hasMore } } };
    this.schedule();
  }

  /** Merges a session's complete detail: the snapshot only carries a window of its jobs, requests, questions and subagents. */
  mergeDetail(detail: SessionDetail): void {
    this.data = {
      ...this.data, sessions: mergeHistory(this.data.sessions, [detail.session, ...detail.subagents]), requests: mergeHistory(this.data.requests, detail.requests),
      questions: mergeHistory(this.data.questions, detail.questions), jobs: mergeHistory(this.data.jobs, detail.jobs), resets: mergeHistory(this.data.resets, detail.resets),
    };
    this.schedule();
  }

  setMemoryHistory(sessionId: SessionMemory['sessionId'], progress: MemoryHistory): void {
    this.data = { ...this.data, memoryHistory: new Map(this.data.memoryHistory).set(sessionId, progress) };
    this.schedule();
  }

  /** Replaces one session's memory summary and items. */
  mergeMemory(sessionId: string, memory: SessionMemory, items: readonly MemoryItem[]): void {
    this.data = { ...this.data, memory: new Map(this.data.memory).set(sessionId, memory), memoryItems: new Map(this.data.memoryItems).set(sessionId, [...items]) };
    this.schedule();
  }

  /** A fresh open must not inherit a previously browsed window or its pending arrivals. */
  resetTranscript(sessionId: Session['id']): void {
    const transcripts = new Map(this.data.transcripts);
    const transcriptHistory = new Map(this.data.transcriptHistory);
    const transcriptsTruncated = new Set(this.data.transcriptsTruncated);
    transcripts.delete(sessionId);
    transcriptHistory.delete(sessionId);
    transcriptsTruncated.delete(sessionId);
    this.pendingTranscripts.delete(sessionId);
    this.data = { ...this.data, transcripts, transcriptHistory, transcriptsTruncated };
    this.schedule();
  }

  setTranscriptProgress(sessionId: Session['id'], change: Partial<TranscriptProgress>): void {
    const progress = this.data.transcriptHistory.get(sessionId) ?? emptyProgress;
    this.data = { ...this.data, transcriptHistory: new Map(this.data.transcriptHistory).set(sessionId, { ...progress, ...change }) };
    this.schedule();
  }

  /** Publishes a page without allowing pending live arrivals to displace a historical window. */
  setTranscriptPage(sessionId: Session['id'], page: Transcript, direction: TranscriptLoad): void {
    const current = this.pendingTranscripts.get(sessionId) ?? this.data.transcripts.get(sessionId) ?? [];
    const window = transcriptPage(current, this.data.transcriptHistory.get(sessionId) ?? emptyProgress, page, direction);
    this.pendingTranscripts.delete(sessionId);
    this.data = { ...this.data, transcripts: new Map(this.data.transcripts).set(sessionId, window.entries), transcriptHistory: new Map(this.data.transcriptHistory).set(sessionId, window.progress) };
    this.schedule();
  }

  /** Merges a backfill page with live entries by cursor, oldest first, bounded. */
  mergeTranscript(sessionId: string, entries: readonly TranscriptEntry[], truncated = false): void {
    if (truncated) {
      this.data = { ...this.data, transcriptsTruncated: new Set(this.data.transcriptsTruncated).add(sessionId) };
      this.setTranscriptProgress(sessionId, { older: true });
    }
    this.appendTranscript(entries, sessionId);
    // An empty transcript is still a loaded one; without this the view would say "Loading" forever.
    if (!this.pendingTranscripts.has(sessionId)) this.pendingTranscripts.set(sessionId, [...(this.data.transcripts.get(sessionId) ?? [])]);
    this.schedule();
  }

  private appendTranscript(entries: readonly TranscriptEntry[], only?: string): void {
    for (const entry of entries) {
      const key = only ?? entry.sessionId;
      const progress = this.data.transcriptHistory.get(key) ?? emptyProgress;
      this.setTranscriptProgress(key, { observedTail: Math.max(progress.observedTail ?? 0, entry.cursor) });
      if (progress.newer) continue;
      this.appendWindowEntry(key, entry);
    }
  }

  private appendWindowEntry(sessionId: Session['id'], entry: TranscriptEntry): void {
    const list = this.pendingTranscripts.get(sessionId) ?? [...(this.data.transcripts.get(sessionId) ?? [])];
    if (!list.some(existing => existing.id === entry.id)) list.push(entry);
    this.pendingTranscripts.set(sessionId, list);
  }

  detail(sessionId: string): SessionDetail | undefined {
    const session = this.data.sessions.find(item => item.id === sessionId);
    if (!session) return undefined;
    const own = <T extends { sessionId: string }>(items: T[]) => items.filter(item => item.sessionId === sessionId);
    return {
      session, requests: own(this.data.requests), questions: own(this.data.questions), jobs: own(this.data.jobs), resets: own(this.data.resets),
      subagents: this.data.sessions.filter(item => item.parentSessionId === sessionId),
    };
  }

  /** Publishes pending changes now. Called by the timer, and directly by tests. */
  flush(): void {
    this.timer = undefined;
    if (this.pendingTranscripts.size > 0) {
      const transcripts = new Map(this.data.transcripts);
      const transcriptsTruncated = new Set(this.data.transcriptsTruncated);
      const transcriptHistory = new Map(this.data.transcriptHistory);
      for (const [key, list] of this.pendingTranscripts) {
        if (list.length > TRANSCRIPT_LIMIT) {
          transcriptsTruncated.add(key);
          transcriptHistory.set(key, { ...transcriptHistory.get(key) ?? emptyProgress, older: true });
        }
        transcripts.set(key, list.sort((a, b) => a.cursor - b.cursor).slice(-TRANSCRIPT_LIMIT));
      }
      this.pendingTranscripts.clear();
      this.data = { ...this.data, transcripts, transcriptsTruncated, transcriptHistory };
    }
    const cutoff = this.now() - 3000;
    const fresh = new Map([...this.data.fresh].filter(([, at]) => at > cutoff));
    for (const [id, at] of this.pendingFresh) fresh.set(id, at);
    this.pendingFresh.clear();
    this.data = { ...this.data, fresh };
    this.dirty = false;
    for (const listener of this.listeners) listener();
  }

  private schedule(): void {
    this.dirty = true;
    this.timer ??= setTimeout(() => { this.flush(); }, 50);
  }

  get pending(): boolean {
    return this.dirty;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
