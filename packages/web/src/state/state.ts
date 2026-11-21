import type {
  AttentionItem, Event as ApiEvent, Graph, Intervention, Job, MemoryItem, Message, Overview, Question, Request, Reset, Session, SessionMemory, Snapshot, TranscriptEntry,
} from '@pi-console/contract';
import type { MemoryReviewSession, Totals, WindowedCollection } from '@pi-console/viewmodels';

export type Repository = Snapshot['repositories'][number];

/** Free-form health rows from `/health` (shape owned by the daemon, docs/api/v1.md); rendered as given. */
export type HealthRecord = Record<string, string | number | boolean>;

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unauthorized';

/** Everything the views read. Built from the snapshot plus deltas; contains no UI state. */
export interface ConsoleState {
  repositories: Repository[];
  sessions: Session[];
  requests: Request[];
  questions: Question[];
  messages: Message[];
  jobs: Job[];
  resets: Reset[];
  interventions: Intervention[];
  /** Retained transcript tail per session id, ascending by cursor. */
  transcripts: Partial<Record<string, TranscriptEntry[]>>;
  /** Intent-memory summary per session id, fetched on demand (never part of the snapshot). */
  memory: Partial<Record<string, SessionMemory>>;
  /** The newest memory items per session id. */
  memoryItems: Partial<Record<string, MemoryItem[]>>;
  memoryReviews: ReadonlyMap<string, MemoryReviewSession>;
  /** The daemon's single attention list; clients never compute their own. */
  needsYou: AttentionItem[];
  /** True once the attention list has arrived; it is fetched after the snapshot, so `snapshotLoaded` alone is too early. */
  needsYouLoaded: boolean;
  graph: Graph | null;
  health: HealthRecord | null;
  overview: Overview | null;
  /** Latest event time seen (epoch ms). Ages are measured against it so views are deterministic and replayable. */
  liveAt: number;
  /** True after even an empty first snapshot; connection attempts are not empty data. */
  snapshotLoaded: boolean;
  seq: number;
  connection: Connection;
  /** Epoch ms of the last frame received; lets clients flag a silent stream as stale. */
  lastFrameAt: number;
  /** Set when the stream announced that deltas were missed and read models were refetched. */
  gapCount: number;
  /** Frames (events and heartbeats) received since this page loaded. */
  received: number;
  /** Sessions whose history was loaded deliberately (a jump to an old line); they keep far more lines than the default window. */
  deepHistory: readonly string[];
  /** Full collection sizes from the daemon; `null` against a daemon that sends complete snapshots. */
  totals: Totals | null;
  /** Collections the snapshot only carried a window of (active items plus the newest); the rest of their history is paged. */
  bounded: readonly WindowedCollection[];
  /** Paging progress per windowed collection once its history has been requested: the next cursor and whether more remains. */
  history: Partial<Record<WindowedCollection, { cursor: string | null; more: boolean }>>;
}

export const transcriptRetention = 2500;
export const deepRetention = 20_000;
export const retentionFor = (state: Pick<ConsoleState, 'deepHistory'>, sessionId: string): number => (state.deepHistory.includes(sessionId) ? deepRetention : transcriptRetention);

export function emptyState(): ConsoleState {
  return {
    repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], interventions: [],
    transcripts: {}, memory: {}, memoryItems: {}, memoryReviews: new Map(), needsYou: [], needsYouLoaded: false, graph: null, health: null, overview: null, liveAt: 0, snapshotLoaded: false, seq: 0,
    connection: 'connecting', lastFrameAt: 0, gapCount: 0, received: 0, deepHistory: [], totals: null, bounded: [], history: {},
  };
}

export type { ApiEvent };

export const sessionById = (state: ConsoleState, id: string): Session | undefined => state.sessions.find(session => session.id === id);

/** Short display label for a session: lane plus name. */
export const sessionLabel = (state: ConsoleState, id: string): string => {
  const session = sessionById(state, id);
  return session ? `${session.laneId} ${session.name}` : id;
};

export const repositoryName = (state: ConsoleState, id: string): string => state.repositories.find(repository => repository.id === id)?.name ?? id;
