import type { DerivedFrom, RequestEvidence, RequestUncertainty, SourceRef } from '@pi-console/contract';
import { insertSorted, projection } from '../projector/handlers.ts';
import type { Projection } from '../projector/projection.ts';

export interface AnswerModel { id: string; text: string; at: string; interim: boolean }

export interface RequestModel {
  id: string;
  sessionId: string;
  text: string;
  origin: 'human' | 'launch' | 'unproven';
  originEvidence: string;
  status: 'open' | 'answered' | 'unanswered' | 'interrupted';
  createdAt: string;
  resetId: string | null;
  answer: AnswerModel | null;
  interimAnswers: AnswerModel[];
  ref: SourceRef | null;
  /** Derivation fields (packages/core/src/requests, docs/requests.md); absent from this pass-through projection. */
  withheld?: boolean;
  answerWithheld?: boolean;
  answerPossiblyUnseen?: boolean;
  uncertainReason?: RequestUncertainty | null;
  evidence?: RequestEvidence[];
  derivedFrom?: DerivedFrom;
}

export interface RequestsState { requests: Record<string, RequestModel> }

/**
 * The seam for P5's request/answer derivation: any projection named `requests` whose state is `RequestsState`.
 * Until P5 registers its own, this one folds the derived catalogue events (`RequestObserved`, `AnswerObserved`,
 * `RequestInterrupted`) as they are, with no pairing heuristics of its own.
 */
export type RequestDerivation = Projection<RequestsState>;

export const requestsProjection: RequestDerivation = projection<RequestsState>('requests', 1, () => ({ requests: {} }), {
  RequestObserved(state, payload, event) {
    state.requests[payload.requestId] = {
      id: payload.requestId, sessionId: payload.sessionId, text: payload.excerpt ?? '', origin: payload.origin,
      originEvidence: payload.originEvidence, status: 'open', createdAt: event.occurredAt, resetId: null, answer: null,
      interimAnswers: [], ref: event.refs,
    };
  },
  AnswerObserved(state, payload, event) {
    // Raw (unpaired) observations carry no requestId; pairing them is P5's request derivation.
    if ('raw' in payload) return;
    const request = state.requests[payload.requestId] as RequestModel | undefined;
    if (!request) return;
    const answer = { id: payload.answerId, text: payload.excerpt ?? '', at: event.occurredAt, interim: payload.interim };
    if (payload.interim) {
      insertSorted(request.interimAnswers, answer, item => `${item.at}|${item.id}`);
      return;
    }
    request.answer = answer;
    request.status = 'answered';
  },
  RequestInterrupted(state, payload) {
    if ('raw' in payload) return;
    const request = state.requests[payload.requestId] as RequestModel | undefined;
    if (!request || request.status === 'answered') return;
    request.status = 'interrupted';
    request.resetId = payload.resetId ?? null;
  },
});
