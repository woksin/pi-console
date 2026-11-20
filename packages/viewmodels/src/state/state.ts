import type {
  AttentionItem, Event as ApiEvent, Graph, Intervention, Job, Message, Overview, Question, Request, Reset, Session, Snapshot, TranscriptEntry,
} from '@pi-console/contract';

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
  /** The daemon's single attention list; clients never compute their own. */
  needsYou: AttentionItem[];
  graph: Graph | null;
  health: HealthRecord | null;
  overview: Overview | null;
  /** Latest event time seen (epoch ms). Ages are measured against it so views are deterministic and replayable. */
  liveAt: number;
  seq: number;
  connection: Connection;
  /** Epoch ms of the last frame received; lets clients flag a silent stream as stale. */
  lastFrameAt: number;
  /** Set when the stream announced that deltas were missed and read models were refetched. */
  gapCount: number;
}

export const transcriptRetention = 2500;

export function emptyState(): ConsoleState {
  return {
    repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], interventions: [],
    transcripts: {}, needsYou: [], graph: null, health: null, overview: null, liveAt: 0, seq: 0,
    connection: 'connecting', lastFrameAt: 0, gapCount: 0,
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
