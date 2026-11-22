import type { EventEnvelope } from '@pi-console/contract';
import { insertSorted, projection } from '../projector/handlers.ts';
import type { RequestDerivation } from '../projections/requests.ts';
import type { DerivationState } from './model.ts';
import { explicit, observe, render, renderOwner, session, stateRequest } from './rendering.ts';

/** Order of facts within a session: when they happened, then file position, then event id. Arrival order is irrelevant. */
const orderOf = (event: EventEnvelope): string => `${event.occurredAt}|${String(event.refs?.offset ?? 0).padStart(15, '0')}|${event.id}`;

const observed = (event: EventEnvelope, entryId: string | null = null) =>
  ({ key: orderOf(event), at: event.occurredAt, entryId: entryId ?? event.refs?.entryId ?? null });

function interruptExplicitly(state: DerivationState, requestId: string, resetId: string | null, event: EventEnvelope): void {
  explicit(state, requestId).interruption = { resetId, key: orderOf(event) };
  renderOwner(state, requestId);
}

/**
 * The request/answer derivation (ADR-0008 Phase A, docs/requests.md). Ordered observations continue a cached pairing
 * machine; late facts and changed lineage re-derive the session. The JSON state alone remains sufficient to replay.
 * Facts that name a request (non-raw) are taken as stated and override the derivation.
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
        stateRequest(state, payload, event, orderOf(event));
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
      insertSorted(explicit(state, payload.requestId).answers, answer, item => item.key);
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
