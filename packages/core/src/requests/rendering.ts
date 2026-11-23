import type { EventEnvelope, EventPayloads } from '@pi-console/contract';
import { entry, insertSorted, markDirty } from '../projector/handlers.ts';
import type { RequestModel } from '../projections/requests.ts';
import { passThroughFields, type DerivationState, type ExplicitFacts, type Observation, type SessionRecord } from './model.ts';
import { changeIndex, changeSuffix } from './session-arrays.ts';
import { find, SessionRenderer } from './session-renderer.ts';

interface Runtime {
  sessions: Map<string, SessionRenderer>;
  rawOwners: Map<string, string>;
  unsafe: boolean;
}
const runtimes = new WeakMap<DerivationState, Runtime>();

function registerPrompt(runtime: Runtime, state: DerivationState, sessionId: string, requestId: string): void {
  if (runtime.rawOwners.has(requestId)) runtime.unsafe = true;
  runtime.rawOwners.set(requestId, sessionId);
  const stated = find(state.explicit, requestId)?.request;
  if (stated && stated.sessionId !== sessionId) runtime.unsafe = true;
}

function register(runtime: Runtime, state: DerivationState, sessionId: string, observation: Observation): void {
  if (observation.kind === 'prompt') registerPrompt(runtime, state, sessionId, observation.requestId);
}

/** Lazy restore: seeds the collision index from streamed prompt owners, so no deferred observation is ever read. */
export function seedRawOwners(state: DerivationState, owners: Iterable<{ sessionId: string; requestId: string }>): void {
  const runtime: Runtime = { sessions: new Map(), rawOwners: new Map(), unsafe: false };
  for (const { sessionId, requestId } of owners) registerPrompt(runtime, state, sessionId, requestId);
  runtimes.set(state, runtime);
}

/** Renderers are reconstructible caches; the collision index stays. Called once changes are durable. */
export function releaseRenderers(state: DerivationState): void {
  runtimes.get(state)?.sessions.clear();
}

function runtimeFor(state: DerivationState): Runtime {
  let runtime = runtimes.get(state);
  if (runtime) return runtime;
  runtime = { sessions: new Map(), rawOwners: new Map(), unsafe: false };
  for (const [id, record] of Object.entries(state.sessions)) {
    for (const observation of record.observations) register(runtime, state, id, observation);
  }
  runtimes.set(state, runtime);
  return runtime;
}

export function session(state: DerivationState, id: string): SessionRecord {
  markDirty(state, 'sessions', id);
  return entry(state.sessions, id, () => ({ facts: { child: false, parentSessionId: null, parentSessionKnown: false }, observations: [], explicitIds: [], requestIds: [] }));
}

export function explicit(state: DerivationState, id: string): ExplicitFacts {
  markDirty(state, 'explicit', id);
  return entry(state.explicit, id, () => ({ request: null, requestKey: null, entryId: null, answers: [], interruption: null }));
}

function rendererFor(state: DerivationState, id: string): SessionRenderer {
  const runtime = runtimeFor(state);
  let renderer = runtime.sessions.get(id);
  if (!renderer) {
    renderer = new SessionRenderer(state, id, session(state, id));
    runtime.sessions.set(id, renderer);
  }
  return renderer;
}

export function render(state: DerivationState, sessionId: string): void {
  const record = find(state.sessions, sessionId);
  if (!record) return;
  const renderer = new SessionRenderer(state, sessionId, record);
  runtimeFor(state).sessions.set(sessionId, renderer);
  renderer.renderAll();
}

function inOrder(record: SessionRecord, observation: Observation): boolean {
  const last = record.observations.at(-1);
  return !last || last.key <= observation.key;
}

export function observe(state: DerivationState, sessionId: string, observation: Observation): void {
  const runtime = runtimeFor(state);
  const record = session(state, sessionId);
  register(runtime, state, sessionId, observation);
  if (inOrder(record, observation) && !runtime.unsafe) {
    const renderer = rendererFor(state, sessionId);
    changeIndex(record, 'observations', record.observations.length);
    record.observations.push(observation);
    renderer.append(observation);
  } else {
    insertSorted(record.observations, observation, item => item.key);
    changeSuffix(record, 'observations', 0);
    render(state, sessionId);
  }
}

export function renderOwner(state: DerivationState, requestId: string): void {
  const sessionId = find(state.explicit, requestId)?.request?.sessionId ?? find(state.requests, requestId)?.sessionId;
  if (!sessionId) return;
  if (runtimeFor(state).unsafe) render(state, sessionId);
  else rendererFor(state, sessionId).refresh(requestId);
}

function statedRequest(payload: EventPayloads['RequestObserved'], event: EventEnvelope): RequestModel {
  return {
    id: payload.requestId, sessionId: payload.sessionId, text: payload.excerpt ?? '', origin: payload.origin,
    originEvidence: payload.originEvidence, status: 'open', createdAt: event.occurredAt, resetId: null, answer: null,
    interimAnswers: [], ref: event.refs, ...passThroughFields(),
    withheld: payload.withheld ?? false, ...(payload.derivedFrom ? { derivedFrom: payload.derivedFrom } : {}),
  };
}

export function stateRequest(state: DerivationState, payload: EventPayloads['RequestObserved'], event: EventEnvelope, key: string): void {
  const { requestId, sessionId } = payload;
  const facts = explicit(state, requestId);
  if (facts.requestKey !== null && facts.requestKey > key) return;
  const previous = facts.request?.sessionId;
  const runtime = runtimeFor(state);
  const rawOwner = runtime.rawOwners.get(requestId);
  if (rawOwner !== undefined && rawOwner !== sessionId) runtime.unsafe = true;
  // Capture the old claims before replacing the stated fact, including on a cold restore.
  if (previous) rendererFor(state, previous);
  const renderer = rendererFor(state, sessionId);
  facts.requestKey = key;
  facts.entryId = payload.entryId ?? event.refs?.entryId ?? null;
  facts.request = statedRequest(payload, event);
  const record = session(state, sessionId);
  if (!renderer.explicitIds.has(requestId)) {
    renderer.explicitIds.add(requestId);
    changeIndex(record, 'explicitIds', record.explicitIds.length);
    record.explicitIds.push(requestId);
  }
  if (previous && previous !== sessionId) refresh(state, previous, requestId);
  refresh(state, sessionId, requestId);
}

function refresh(state: DerivationState, sessionId: string, requestId: string): void {
  if (runtimeFor(state).unsafe) render(state, sessionId);
  else rendererFor(state, sessionId).refresh(requestId);
}
