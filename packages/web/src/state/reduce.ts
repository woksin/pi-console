import type { SessionDetail, TranscriptEntry } from '@pi-console/contract';
import { mergeHistory, mergeSnapshot, type WindowedCollection } from '@pi-console/viewmodels';
import type { ListPage } from '../client/api.ts';
import type { ApiEvent, ConsoleState } from './state.ts';
import { emptyProgress, transcriptArrival } from './transcript-history.ts';

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) return [...items, item];
  const copy = [...items];
  copy[index] = item;
  return copy;
}

function withTranscript(state: ConsoleState, entry: TranscriptEntry): ConsoleState {
  const current = state.transcripts[entry.sessionId] ?? [];
  if (current.some(existing => existing.id === entry.id)) return state;
  const result = transcriptArrival(current, state.transcriptHistory[entry.sessionId] ?? emptyProgress, entry);
  return { ...state, transcripts: { ...state.transcripts, [entry.sessionId]: result.entries }, transcriptHistory: { ...state.transcriptHistory, [entry.sessionId]: result.progress } };
}

const latest = (...times: string[]): number => Math.max(0, ...times.map(time => Date.parse(time)).filter(Number.isFinite));

/** Applies one SSE delta. Event time comes from entity timestamps, not delivery time. Pure: same state and event always give the same result (needed for replayable views). */
export function applyEvent(state: ConsoleState, event: ApiEvent): ConsoleState {
  const base: ConsoleState = { ...state, seq: event.seq };
  switch (event.type) {
    case 'snapshot': return fromSnapshot(base, event.payload);
    case 'session.updated': {
      const session = { ...event.payload };
      delete session.memoryChanged;
      return { ...base, sessions: upsert(base.sessions, session), liveAt: Math.max(base.liveAt, latest(session.updatedAt)) };
    }
    case 'transcript.appended': return withTranscript({ ...base, liveAt: Math.max(base.liveAt, latest(event.payload.at)) }, event.payload);
    case 'message.sent': return { ...base, messages: upsert(base.messages, event.payload), liveAt: Math.max(base.liveAt, latest(event.payload.sentAt)) };
    default: return applyEntityEvent(base, event);
  }
}

/** The events that only upsert an entity into its list. */
function applyEntityEvent(base: ConsoleState, event: Exclude<ApiEvent, { type: 'snapshot' | 'session.updated' | 'transcript.appended' | 'message.sent' }>): ConsoleState {
  switch (event.type) {
    case 'request.observed':
    case 'request.interrupted': return { ...base, requests: upsert(base.requests, event.payload) };
    case 'question.asked': return { ...base, questions: upsert(base.questions, event.payload) };
    case 'job.updated':
    case 'job.finished': return { ...base, jobs: upsert(base.jobs, event.payload) };
    case 'reset.occurred': return { ...base, resets: upsert(base.resets, event.payload) };
    case 'intervention.recorded': return { ...base, interventions: upsert(base.interventions, event.payload).slice(-200) };
  }
}

export function applyEvents(state: ConsoleState, events: readonly ApiEvent[]): ConsoleState {
  return events.reduce(applyEvent, state);
}

type SnapshotPayload = Extract<ApiEvent, { type: 'snapshot' }>['payload'];

const windowed: readonly WindowedCollection[] = ['sessions', 'requests', 'questions', 'messages', 'jobs', 'resets'];

function fromSnapshot(state: ConsoleState, snapshot: SnapshotPayload): ConsoleState {
  const known = state.seq > 0 || state.sessions.length > 0;
  const bounded = snapshot.bounded ?? [];
  const times = [snapshot.generatedAt, ...snapshot.messages.map(message => message.sentAt), ...snapshot.sessions.map(session => session.updatedAt)];
  const lists = Object.fromEntries(windowed.map(name => [name, bounded.includes(name) ? mergeSnapshot(name, state[name] as { id: string }[], snapshot[name] as { id: string }[]) : snapshot[name]])) as Pick<ConsoleState, WindowedCollection>;
  return {
    ...state, ...lists,
    repositories: snapshot.repositories, interventions: snapshot.interventions, snapshotLoaded: true,
    totals: snapshot.totals ?? null, bounded,
    // A resnapshot drops rows that stopped being active, so exhausted paging progress is void: history is reloadable again.
    history: {},
    pageStatus: {},
    liveAt: Math.max(state.liveAt, latest(...times)),
    gapCount: state.gapCount + (known ? 1 : 0),
  };
}

/** Merges one history page of a windowed collection. Rows already held win; the page's total refreshes the count. */
export function mergePage<C extends WindowedCollection>(state: ConsoleState, collection: C, page: ListPage<C>): ConsoleState {
  const total = state.totals ? { ...state.totals, [collection]: page.total } : state.totals;
  return {
    ...state, [collection]: mergeHistory(state[collection] as { id: string }[], page.items), totals: total,
    history: { ...state.history, [collection]: { cursor: page.nextCursor, more: page.hasMore } },
  };
}

/** Merges a session's complete detail (its own jobs, requests, questions, resets and subagents). */
export function mergeSessionDetail(state: ConsoleState, detail: SessionDetail): ConsoleState {
  return {
    ...state, sessions: mergeHistory(state.sessions, [detail.session, ...detail.subagents]), requests: mergeHistory(state.requests, detail.requests),
    questions: mergeHistory(state.questions, detail.questions), jobs: mergeHistory(state.jobs, detail.jobs), resets: mergeHistory(state.resets, detail.resets),
  };
}
