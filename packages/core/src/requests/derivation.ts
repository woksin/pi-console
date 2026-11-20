import type { EventEnvelope, EventPayloads } from '@pi-console/contract';
import { entry, insertSorted, markDirty, projection } from '../projector/handlers.ts';
import type { RequestDerivation, RequestModel } from '../projections/requests.ts';
import { passThroughFields, type DerivationState, type ExplicitFacts, type Observation, type SessionRecord } from './model.ts';
import { pairSession } from './pairing.ts';

/** Order of facts within a session: when they happened, then file position, then event id. Arrival order is irrelevant. */
const orderOf = (event: EventEnvelope): string => `${event.occurredAt}|${String(event.refs?.offset ?? 0).padStart(15, '0')}|${event.id}`;

const observed = (event: EventEnvelope, entryId: string | null = null) =>
  ({ key: orderOf(event), at: event.occurredAt, entryId: entryId ?? event.refs?.entryId ?? null });

/** Own-property lookup: ids come from ingested data, so inherited names never resolve. */
const find = <Item>(items: Record<string, Item>, id: string): Item | undefined => Object.hasOwn(items, id) ? items[id] : undefined;

const session = (state: DerivationState, sessionId: string): SessionRecord => {
  markDirty(state, 'sessions', sessionId);
  return entry(state.sessions, sessionId, () => ({
    facts: { child: false, parentSessionId: null, parentSessionKnown: false }, observations: [], explicitIds: [], requestIds: [],
  }));
};

const explicitFor = (state: DerivationState, requestId: string): ExplicitFacts => {
  markDirty(state, 'explicit', requestId);
  return entry(state.explicit, requestId, () => ({ request: null, requestKey: null, entryId: null, answers: [], interruption: null }));
};

/** Explicit answers and interruptions win over the derivation; interruption never undoes an answer. */
function overlay(request: RequestModel, facts: ExplicitFacts | undefined): RequestModel {
  for (const { id, text, at, interim, withheld } of facts?.answers ?? []) {
    const answer = { id, text, at, interim };
    if (answer.interim) request.interimAnswers.push(answer);
    else Object.assign(request, { answer, status: 'answered', answerWithheld: withheld });
  }
  if (facts?.interruption && request.status !== 'answered') {
    request.status = 'interrupted';
    request.resetId = facts.interruption.resetId;
  }
  return request;
}

/** Re-derives every request of one session from its facts and replaces what the session contributed before. */
function render(state: DerivationState, sessionId: string): void {
  const record = session(state, sessionId);
  for (const id of record.requestIds) {
    markDirty(state, 'requests', id);
    Reflect.deleteProperty(state.requests, id);
  }
  const owned = record.explicitIds.flatMap(id => { const facts = find(state.explicit, id); return facts?.request?.sessionId === sessionId ? [facts] : []; });
  const stated = owned.flatMap(facts => facts.request ?? []);
  const claimed = new Set(owned.flatMap(facts => facts.entryId ?? []));
  const derived = pairSession(sessionId, record.facts, record.observations)
    .filter(request => !claimed.has(request.ref?.entryId ?? '') && !find(state.explicit, request.id)?.request);
  const requests = [...derived, ...stated.map(request => structuredClone(request))].map(request => overlay(request, find(state.explicit, request.id)));
  for (const request of requests) {
    markDirty(state, 'requests', request.id);
    state.requests[request.id] = request;
  }
  record.requestIds = requests.map(request => request.id);
}

function observe(state: DerivationState, sessionId: string, observation: Observation): void {
  insertSorted(session(state, sessionId).observations, observation, item => item.key);
  render(state, sessionId);
}

/** Renders the session of an explicitly stated request, once that request is known. */
function renderOwner(state: DerivationState, requestId: string): void {
  const sessionId = find(state.explicit, requestId)?.request?.sessionId ?? find(state.requests, requestId)?.sessionId;
  if (sessionId) render(state, sessionId);
}

function interruptExplicitly(state: DerivationState, requestId: string, resetId: string | null, event: EventEnvelope): void {
  explicitFor(state, requestId).interruption = { resetId, key: orderOf(event) };
  renderOwner(state, requestId);
}

function stateRequest(state: DerivationState, payload: EventPayloads['RequestObserved'], event: EventEnvelope): void {
  const facts = explicitFor(state, payload.requestId);
  const key = orderOf(event);
  if (facts.requestKey !== null && facts.requestKey > key) return;
  const previous = facts.request?.sessionId;
  facts.requestKey = key;
  facts.entryId = payload.entryId ?? event.refs?.entryId ?? null;
  facts.request = {
    id: payload.requestId, sessionId: payload.sessionId, text: payload.excerpt ?? '', origin: payload.origin,
    originEvidence: payload.originEvidence, status: 'open', createdAt: event.occurredAt, resetId: null, answer: null,
    interimAnswers: [], ref: event.refs, ...passThroughFields(),
    withheld: payload.withheld ?? false, ...(payload.derivedFrom ? { derivedFrom: payload.derivedFrom } : {}),
  };
  const record = session(state, payload.sessionId);
  if (!record.explicitIds.includes(payload.requestId)) record.explicitIds.push(payload.requestId);
  // A request restated in another session moves: the old session drops it first, then the new one adds it.
  if (previous && previous !== payload.sessionId) render(state, previous);
  render(state, payload.sessionId);
}

/**
 * The request/answer derivation (ADR-0008 Phase A, docs/requests.md). Raw observations from session JSONL are kept per
 * session in occurrence order and re-paired on every new fact, so the result depends only on the set of facts. Facts
 * that name a request (non-raw) are taken as stated and override the derivation.
 */
export const requestDerivation: RequestDerivation = projection<DerivationState>(
  'requests', 4, () => ({ requests: {}, sessions: {}, explicit: {} }), {
    SessionStarted(state, payload) {
      session(state, payload.sessionId).facts = {
        child: payload.role === 'subagent', parentSessionId: payload.parentSessionId, parentSessionKnown: payload.parentSessionKnown === true,
      };
      render(state, payload.sessionId);
    },
    SubagentStarted(state, payload) {
      session(state, payload.sessionId).facts = { child: true, parentSessionId: payload.parentSessionId, parentSessionKnown: true };
      render(state, payload.sessionId);
    },
    RequestObserved(state, payload, event) {
      if (!payload.raw) {
        stateRequest(state, payload, event);
        return;
      }
      observe(state, payload.sessionId, {
        kind: 'prompt', ...observed(event, payload.entryId), requestId: payload.requestId, text: payload.excerpt ?? '',
        withheld: payload.withheld ?? false, ref: event.refs, derivedFrom: payload.derivedFrom ?? 'session-jsonl',
      });
    },
    AnswerObserved(state, payload, event) {
      if ('raw' in payload) {
        observe(state, payload.sessionId, { kind: 'answer', ...observed(event, payload.entryId), answerId: payload.answerId, text: payload.excerpt, withheld: payload.withheld });
        return;
      }
      const answer = { id: payload.answerId, text: payload.excerpt ?? '', at: event.occurredAt, interim: payload.interim, key: orderOf(event), withheld: payload.withheld ?? false };
      insertSorted(explicitFor(state, payload.requestId).answers, answer, item => item.key);
      renderOwner(state, payload.requestId);
    },
    RequestInterrupted(state, payload, event) {
      if ('raw' in payload) {
        observe(state, payload.sessionId, { kind: 'abort', ...observed(event, payload.entryId) });
        return;
      }
      interruptExplicitly(state, payload.requestId, payload.resetId ?? null, event);
    },
    ResetOccurred(state, payload, event) {
      for (const requestId of payload.interruptedRequestIds ?? []) interruptExplicitly(state, requestId, payload.resetId, event);
      observe(state, payload.sessionId, { kind: 'reset', ...observed(event), resetId: payload.resetId });
    },
    SessionEnded(state, payload, event) {
      observe(state, payload.sessionId, { kind: 'end', ...observed(event) });
    },
  }, ['requests', 'sessions', 'explicit'],
);
