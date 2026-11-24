import type {
  AttentionItem, Event as ApiEvent, Graph, Intervention, Job, MemoryItem, Message, Overview, Question, Request, Reset, Session, SessionMemory, Snapshot, TranscriptEntry,
} from '@pi-console/contract';
import { sessionLabels, type MemoryReviewSession, type Totals, type WindowedCollection } from '@pi-console/viewmodels';
import type { TranscriptProgress } from './transcript-history.ts';

export type Repository = Snapshot['repositories'][number];

/** Free-form health rows from `/health` (shape owned by the daemon, docs/api/v1.md); rendered as given. */
export type HealthRecord = Record<string, string | number | boolean>;

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unauthorized';

export type MemoryReadStatus = { status: 'loading' | 'loaded' | 'absent' } | { status: 'error'; message: string };

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
  /** Read status is independent of cached data; only `storeDetected: false` confirms absence. */
  memoryStatus: Partial<Record<string, MemoryReadStatus>>;
  memoryReviews: ReadonlyMap<string, MemoryReviewSession>;
  /** The daemon's single attention list; clients never compute their own. */
  needsYou: AttentionItem[];
  /** True after a successful attention fetch, until a fetch fails; `snapshotLoaded` alone is too early. */
  needsYouLoaded: boolean;
  needsYouError: boolean;
  /** A successful attention fetch has supplied a cached count, including zero. */
  needsYouCached: boolean;
  graph: Graph | null;
  /** The last canonical graph read failed; the previous graph, if any, is kept. */
  graphError: boolean;
  health: HealthRecord | null;
  overview: Overview | null;
  /** Latest event time seen (epoch ms). Ages are measured against it so views are deterministic and replayable. */
  liveAt: number;
  /** Wall time when `liveAt` last advanced; the display clock anchor, independent of transport activity. */
  liveAtReceivedAt: number | null;
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
  /** The visible transcript's bounded-window edges and request status, independent of follow/pause. */
  transcriptHistory: Partial<Record<string, TranscriptProgress>>;
  /** Full collection sizes from the daemon; `null` against a daemon that sends complete snapshots. */
  totals: Totals | null;
  /** Collections the snapshot only carried a window of (active items plus the newest); the rest of their history is paged. */
  bounded: readonly WindowedCollection[];
  /** Paging progress per windowed collection once its history has been requested: the next cursor and whether more remains. */
  history: Partial<Record<WindowedCollection, { cursor: string | null; more: boolean }>>;
  /** A history page in flight or failed, per windowed collection; absent when idle. */
  pageStatus: Partial<Record<WindowedCollection, 'loading' | 'failed'>>;
}

export function emptyState(): ConsoleState {
  return {
    repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], interventions: [],
    transcripts: {}, memory: {}, memoryItems: {}, memoryStatus: {}, memoryReviews: new Map(), needsYou: [], needsYouLoaded: false, needsYouError: false, needsYouCached: false, graph: null, graphError: false, health: null, overview: null, liveAt: 0, liveAtReceivedAt: null, snapshotLoaded: false, seq: 0,
    connection: 'connecting', lastFrameAt: 0, gapCount: 0, received: 0, transcriptHistory: {}, totals: null, bounded: [], history: {}, pageStatus: {},
  };
}

export type { ApiEvent };

export const sessionById = (state: ConsoleState, id: string): Session | undefined => state.sessions.find(session => session.id === id);

/** Short display label for a session: lane plus name. */
export const sessionLabel = (state: ConsoleState, id: string): string => {
  const session = sessionById(state, id);
  return session ? sessionLabels(session).title : id;
};

export const repositoryName = (state: ConsoleState, id: string): string => state.repositories.find(repository => repository.id === id)?.name ?? id;
