import type { TranscriptEntry } from '@pi-console/contract';
import { transcriptRetention, type ApiEvent, type ConsoleState } from './state.ts';

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
  const next = [...current, entry].sort((a, b) => a.cursor - b.cursor);
  if (next.length > transcriptRetention) next.splice(0, next.length - transcriptRetention);
  return { ...state, transcripts: { ...state.transcripts, [entry.sessionId]: next } };
}

const latest = (...times: string[]): number => Math.max(0, ...times.map(time => Date.parse(time)).filter(Number.isFinite));

/** Applies one SSE delta. Event time comes from entity timestamps, not delivery time. Pure: same state and event always give the same result (needed for replayable views). */
export function applyEvent(state: ConsoleState, event: ApiEvent): ConsoleState {
  const base: ConsoleState = { ...state, seq: event.seq };
  switch (event.type) {
    case 'snapshot': return fromSnapshot(base, event.payload);
    case 'session.updated': return { ...base, sessions: upsert(base.sessions, event.payload), liveAt: Math.max(base.liveAt, latest(event.payload.updatedAt)) };
    case 'transcript.appended': return withTranscript({ ...base, liveAt: Math.max(base.liveAt, latest(event.payload.at)) }, event.payload);
    case 'request.observed':
    case 'request.interrupted': return { ...base, requests: upsert(base.requests, event.payload) };
    case 'question.asked': return { ...base, questions: upsert(base.questions, event.payload) };
    case 'message.sent': return { ...base, messages: upsert(base.messages, event.payload), liveAt: Math.max(base.liveAt, latest(event.payload.sentAt)) };
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

function fromSnapshot(state: ConsoleState, snapshot: SnapshotPayload): ConsoleState {
  const known = state.seq > 0 || state.sessions.length > 0;
  const times = [snapshot.generatedAt, ...snapshot.messages.map(message => message.sentAt), ...snapshot.sessions.map(session => session.updatedAt)];
  return {
    ...state,
    repositories: snapshot.repositories, sessions: snapshot.sessions, requests: snapshot.requests, questions: snapshot.questions,
    messages: snapshot.messages, jobs: snapshot.jobs, resets: snapshot.resets, interventions: snapshot.interventions,
    liveAt: Math.max(state.liveAt, latest(...times)),
    gapCount: state.gapCount + (known ? 1 : 0),
  };
}
