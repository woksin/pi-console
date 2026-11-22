import { type MemoryReviewSession, mergeHistory, mergeSnapshot, type Totals, type WindowedCollection } from '@pi-console/viewmodels';
import type { AttentionItem, Event, Job, MemoryItem, Message, Question, Request, Reset, Session, SessionDetail, SessionMemory, TranscriptEntry } from '@pi-console/contract';

export const TRANSCRIPT_LIMIT = 2500;
const upsert = <T extends { id: string }>(items: T[], item: T): T[] => {
  const index = items.findIndex(existing => existing.id === item.id);
  return index < 0 ? [...items, item] : items.map((existing, position) => (position === index ? item : existing));
};

export interface Connection { connected: boolean; error: string; lastSeq: number | undefined; lastEventAt: number | undefined; eventsReceived: number }
export interface Data {
  loaded: boolean; connection: Connection; repositories: number;
  sessions: Session[]; requests: Request[]; questions: Question[]; messages: Message[]; jobs: Job[]; resets: Reset[];
  /** Full collection sizes from a bounded snapshot; `null` when the daemon sent complete lists. */
  totals: Totals | null; bounded: readonly WindowedCollection[];
  /** Paging progress per windowed collection once its history has been requested. */
  history: Partial<Record<WindowedCollection, { cursor: string | null; more: boolean }>>;
  needsYou: AttentionItem[]; transcripts: ReadonlyMap<string, TranscriptEntry[]>;
  /** True once the daemon's attention list has arrived; it is fetched after the snapshot, so `loaded` alone is too early. */
  needsYouLoaded: boolean;
  /** Read-only intent memory per session id, fetched when its session is opened. */
  memory: ReadonlyMap<string, SessionMemory>; memoryItems: ReadonlyMap<string, MemoryItem[]>;
  memoryReviews: ReadonlyMap<string, MemoryReviewSession>;
  /** Ids of entities touched since the last render, used for the brief "just changed" highlight. */
  fresh: ReadonlyMap<string, number>;
}

/**
 * Client-side mirror of the daemon's state. It only folds events into collections; attention, pairing and status are
 * the daemon's. Updates are coalesced so a stream of thousands of events renders at most ~20 times a second.
 */
export class Store {
  private data: Data = {
    loaded: false, connection: { connected: false, error: 'Connecting…', lastSeq: undefined, lastEventAt: undefined, eventsReceived: 0 }, repositories: 0,
    sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], totals: null, bounded: [], history: {}, needsYou: [], needsYouLoaded: false, transcripts: new Map(), memory: new Map(), memoryItems: new Map(), memoryReviews: new Map(), fresh: new Map(),
  };
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

  setConnection(connected: boolean, error: string): void {
    this.data = { ...this.data, connection: { ...this.data.connection, connected, error } };
    this.schedule();
  }

  setNeedsYou(needsYou: AttentionItem[]): void {
    this.data = { ...this.data, needsYou, needsYouLoaded: true };
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

  /** Replaces one session's memory summary and items. */
  mergeMemory(sessionId: string, memory: SessionMemory, items: readonly MemoryItem[]): void {
    this.data = { ...this.data, memory: new Map(this.data.memory).set(sessionId, memory), memoryItems: new Map(this.data.memoryItems).set(sessionId, [...items]) };
    this.schedule();
  }

  /** Merges a backfill page with live entries by cursor, oldest first, bounded. */
  mergeTranscript(sessionId: string, entries: readonly TranscriptEntry[]): void {
    this.appendTranscript(entries, sessionId);
    // An empty transcript is still a loaded one; without this the view would say "Loading" forever.
    if (!this.pendingTranscripts.has(sessionId)) this.pendingTranscripts.set(sessionId, [...(this.data.transcripts.get(sessionId) ?? [])]);
    this.schedule();
  }

  private appendTranscript(entries: readonly TranscriptEntry[], only?: string): void {
    for (const entry of entries) {
      const key = only ?? entry.sessionId;
      const list = this.pendingTranscripts.get(key) ?? [...(this.data.transcripts.get(key) ?? [])];
      if (!list.some(existing => existing.id === entry.id)) list.push(entry);
      this.pendingTranscripts.set(key, list);
    }
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
      for (const [key, list] of this.pendingTranscripts) transcripts.set(key, list.sort((a, b) => a.cursor - b.cursor).slice(-TRANSCRIPT_LIMIT));
      this.pendingTranscripts.clear();
      this.data = { ...this.data, transcripts };
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
