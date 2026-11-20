import type { EventEnvelope, SourceRef } from '@pi-console/contract';
import { entry, insertSorted, orderKey, projection } from '../projector/handlers.ts';

export interface ResetModel {
  id: string; kind: 'handoff' | 'compaction' | 'relaunch'; at: string;
  carriedRequestIds: string[]; interruptedRequestIds: string[];
}

export interface SessionModel {
  id: string;
  cwd: string;
  model: string | null;
  thinkingLevel: string | null;
  role: 'orchestrator' | 'main' | 'subagent';
  parentSessionId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  endReason: string | null;
  /** Turn currently running, if any. */
  openTurnId: string | null;
  heartbeatStatus: string | null;
  resets: ResetModel[];
  /** Last place this session wrote to its transcript, for signal-to-transcript navigation. */
  lastRef: SourceRef | null;
  /** orderKey of the event that last set each latest-value field, so late (backfilled) events cannot overwrite newer ones. */
  stamps: Partial<Record<LatestField, string>>;
  /** Timestamped turn facts survive end-before-start delivery and snapshot restores. */
  turns: Record<string, { start: string; end: string }>;
  latestTurnId: string | null;
  latestTurnKey: string;
}

type LatestField = 'model' | 'thinkingLevel' | 'heartbeatStatus' | 'lastRef' | 'cwd' | 'role' | 'parentSessionId' | 'endedAt' | 'endReason';

export interface SessionsState { sessions: Record<string, SessionModel> }

const blank = (id: string, event: EventEnvelope): SessionModel => ({
  id, cwd: '', model: null, thinkingLevel: null, role: 'main', parentSessionId: null, startedAt: event.occurredAt,
  updatedAt: event.occurredAt, endedAt: null, endReason: null, openTurnId: null, heartbeatStatus: null, resets: [], lastRef: null, stamps: {}, turns: Object.create(null) as SessionModel['turns'], latestTurnId: null, latestTurnKey: '',
});

/** Sets a latest-value field unless a newer event already set it. */
function setLatest<Field extends LatestField>(session: SessionModel, field: Field, value: SessionModel[Field], event: EventEnvelope): void {
  const key = orderKey(event);
  const stamp = session.stamps[field];
  if (stamp !== undefined && stamp > key) return;
  session[field] = value;
  session.stamps[field] = key;
}

/** Max of two ISO-8601 UTC timestamps (lexical order is time order). Keeps the result independent of arrival order. */
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** The session an event is about; created on first sight so mid-stream backfill still yields a row. */
function touch(state: SessionsState, sessionId: string, event: EventEnvelope): SessionModel {
  const session = entry(state.sessions, sessionId, () => blank(sessionId, event));
  session.startedAt = earlier(session.startedAt, event.occurredAt);
  session.updatedAt = later(session.updatedAt, event.occurredAt);
  if (event.refs) setLatest(session, 'lastRef', event.refs, event);
  return session;
}

/** The newest start remains open only when no later end (or session end) closes it. */
function resolveTurn(session: SessionModel): void {
  session.openTurnId = null;
  if (session.latestTurnId === null) return;
  const turn = session.turns[session.latestTurnId];
  if (turn.start > turn.end && turn.start > (session.stamps.endedAt ?? '')) session.openTurnId = session.latestTurnId;
}

function turnFact(state: SessionsState, sessionId: string, turnId: string, event: EventEnvelope, field: 'start' | 'end'): void {
  const session = touch(state, sessionId, event);
  const turn = entry(session.turns, turnId, () => ({ start: '', end: '' }));
  const key = orderKey(event);
  turn[field] = later(turn[field], key);
  if (field === 'start' && key > session.latestTurnKey) {
    session.latestTurnId = turnId;
    session.latestTurnKey = key;
  }
  resolveTurn(session);
}

export const sessionsProjection = projection<SessionsState>('sessions', 2, () => ({ sessions: {} }), {
  SessionStarted(state, payload, event) {
    const session = touch(state, payload.sessionId, event);
    setLatest(session, 'cwd', payload.cwd, event);
    setLatest(session, 'role', payload.role, event);
    setLatest(session, 'parentSessionId', payload.parentSessionId, event);
    setLatest(session, 'model', payload.model, event);
  },
  SessionEnded(state, payload, event) {
    const session = touch(state, payload.sessionId, event);
    setLatest(session, 'endedAt', event.occurredAt, event);
    setLatest(session, 'endReason', payload.reason, event);
    resolveTurn(session);
  },
  ModelChanged(state, payload, event) { setLatest(touch(state, payload.sessionId, event), 'model', payload.model, event); },
  ThinkingLevelChanged(state, payload, event) { setLatest(touch(state, payload.sessionId, event), 'thinkingLevel', payload.level, event); },
  TurnStarted(state, payload, event) { turnFact(state, payload.sessionId, payload.turnId, event, 'start'); },
  TurnEnded(state, payload, event) { turnFact(state, payload.sessionId, payload.turnId, event, 'end'); },
  SessionHeartbeat(state, payload, event) { setLatest(touch(state, payload.sessionId, event), 'heartbeatStatus', payload.status ?? null, event); },
  ResetOccurred(state, payload, event) {
    const session = touch(state, payload.sessionId, event);
    // A reset seen twice keeps its earliest sighting, whatever order the sightings arrive in.
    const key = (reset: ResetModel) => `${reset.at}|${reset.id}`;
    const seen = session.resets.findIndex(reset => reset.id === payload.resetId);
    if (seen >= 0 && key(session.resets[seen]) <= `${event.occurredAt}|${payload.resetId}`) return;
    if (seen >= 0) session.resets.splice(seen, 1);
    insertSorted(session.resets, {
      id: payload.resetId, kind: payload.kind, at: event.occurredAt,
      carriedRequestIds: payload.carriedRequestIds ?? [], interruptedRequestIds: payload.interruptedRequestIds ?? [],
    }, key);
  },
  SubagentStarted(state, payload, event) {
    const session = touch(state, payload.sessionId, event);
    setLatest(session, 'role', 'subagent', event);
    setLatest(session, 'parentSessionId', payload.parentSessionId, event);
  },
});
