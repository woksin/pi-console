import type { EventEnvelope } from '@pi-console/contract';
import type { ProjectionRuntime } from '../projector/projection.ts';
import type { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import type { DerivationState } from './model.ts';
import type { SqliteRequestSessions } from './sqlite-sessions.ts';
import { releaseRenderers, seedRawOwners } from './rendering.ts';
import { find } from './session-renderer.ts';

type Payload = Record<string, unknown>;

/** Same owner lookup the derivation uses to route an answer/interruption that names only a request. */
function ownerOf(state: DerivationState, requestId: unknown): string[] {
  if (typeof requestId !== 'string') return [];
  const owner = find(state.explicit, requestId)?.request?.sessionId ?? find(state.requests, requestId)?.sessionId;
  return owner === undefined ? [] : [owner];
}

type Needs = (state: DerivationState, payload: Payload) => string[];
const named = (payload: Payload): string[] => typeof payload.sessionId === 'string' ? [payload.sessionId] : [];
const rawOrOwner: Needs = (state, payload) => payload.raw ? named(payload) : ownerOf(state, payload.requestId);

/** Sessions whose arrays the derivation reads or writes, by event type. Unlisted (unrelated) events need none. */
const needs: Partial<Record<string, Needs>> = {
  SessionStarted: (_, payload) => named(payload),
  SubagentStarted: (_, payload) => named(payload),
  SessionEnded: (_, payload) => named(payload),
  RequestObserved: (state, payload) => payload.raw ? named(payload) : [...ownerOf(state, payload.requestId), ...named(payload)],
  AnswerObserved: rawOrOwner,
  RequestInterrupted: rawOrOwner,
  ResetOccurred: (state, payload) => {
    const interrupted = Array.isArray(payload.interruptedRequestIds) ? payload.interruptedRequestIds : [];
    return [...named(payload), ...interrupted.flatMap(id => ownerOf(state, id))];
  },
};

const sessionsNeeded = (state: DerivationState, event: EventEnvelope): string[] =>
  needs[event.type]?.(state, event.payload as Payload) ?? [];

/** Raw prompt owners: resident inline sessions from state, normalized ones streamed from disk (never stale rows). */
function* promptOwners(state: DerivationState, deferred: ReadonlySet<string>, sessions: SqliteRequestSessions) {
  for (const [sessionId, record] of Object.entries(state.sessions)) {
    if (deferred.has(sessionId)) continue;
    for (const item of record.observations) if (item.kind === 'prompt') yield { sessionId, requestId: item.requestId };
  }
  for (const owner of sessions.promptOwners()) if (deferred.has(owner.sessionId)) yield owner;
}

/**
 * Lifecycle for the request derivation: warm restore leaves normalized session histories on disk, an event hydrates only
 * the sessions it needs, and a successful commit releases them (and the renderer cache) again. The reducer still sees
 * complete plain arrays; public request rows stay resident, so queries never hydrate anything.
 */
export function createRequestHistoryRuntime(store: SqliteProjectionStore): ProjectionRuntime {
  const sessions = store.requestSessions;
  let state: DerivationState;
  let deferred = new Set<string>();
  const hydrated = new Set<string>();
  return {
    restore() {
      const restored = store.loadRequests();
      deferred = restored?.deferred ?? new Set();
      return restored?.record;
    },
    bind(value, restored) {
      state = value as DerivationState;
      if (!restored) { deferred.clear(); return; }
      seedRawOwners(state, promptOwners(state, deferred, sessions));
    },
    beforeApply(event) {
      for (const id of sessionsNeeded(state, event)) {
        if (!deferred.delete(id)) continue;
        sessions.hydrate(id, state.sessions[id]);
        hydrated.add(id);
      }
    },
    afterCommit(dirty) {
      for (const id of new Set([...hydrated, ...dirty.get('sessions') ?? []])) {
        const record = find(state.sessions, id);
        if (record && sessions.release(record)) deferred.add(id);
      }
      hydrated.clear();
      releaseRenderers(state);
    },
    querySource: undefined,
  };
}
