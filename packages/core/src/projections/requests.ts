import type { DerivedFrom, EventEnvelope, RequestEvidence, RequestUncertainty, SourceRef } from '@pi-console/contract';
import { entry, insertSorted, markDirty, orderKey, projection } from '../projector/handlers.ts';
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
  stamps: Partial<Record<string, string>>;
  interruptedResetId: string | null;
}

export interface RequestsState { requests: Record<string, RequestModel> }

/**
 * The seam for P5's request/answer derivation: any projection named `requests` whose state is `RequestsState`.
 * Until P5 registers its own, this one folds the derived catalogue events (`RequestObserved`, `AnswerObserved`,
 * `RequestInterrupted`) as they are, with no pairing heuristics of its own.
 */
export type RequestDerivation = Projection<RequestsState>;

function request(state: RequestsState, id: string, sessionId: string): RequestModel {
  markDirty(state, 'requests', id);
  return entry(state.requests, id, () => ({
    id, sessionId, text: '', origin: 'unproven', originEvidence: '', status: 'open', createdAt: '',
    resetId: null, answer: null, interimAnswers: [], ref: null, stamps: Object.create(null) as Record<string, string>, interruptedResetId: null,
  }));
}

function latest(row: RequestModel, field: string, event: EventEnvelope, apply: () => void): void {
  const key = orderKey(event);
  if (key < (row.stamps[field] ?? '')) return;
  apply();
  row.stamps[field] = key;
}

function status(row: RequestModel): void {
  const observed = row.stamps.observed ?? '';
  row.status = 'open';
  if ((row.stamps.interrupted ?? '') > observed) row.status = 'interrupted';
  if ((row.stamps.answer ?? '') > observed) row.status = 'answered';
  row.resetId = row.status === 'interrupted' ? row.interruptedResetId : null;
}

export const requestsProjection: RequestDerivation = projection<RequestsState>('requests', 2, () => ({ requests: {} }), {
  RequestObserved(state, payload, event) {
    const row = request(state, payload.requestId, payload.sessionId);
    latest(row, 'observed', event, () => {
      Object.assign(row, { sessionId: payload.sessionId, text: payload.excerpt ?? '', origin: payload.origin,
        originEvidence: payload.originEvidence, createdAt: event.occurredAt, ref: event.refs });
    });
    status(row);
  },
  AnswerObserved(state, payload, event) {
    // Raw (unpaired) observations carry no requestId; pairing them is P5's request derivation.
    if ('raw' in payload) return;
    const row = request(state, payload.requestId, '');
    const answer = { id: payload.answerId, text: payload.excerpt ?? '', at: event.occurredAt, interim: payload.interim };
    if (payload.interim) {
      insertSorted(row.interimAnswers, answer, item => `${item.at}|${item.id}`);
      return;
    }
    latest(row, 'answer', event, () => { row.answer = answer; });
    status(row);
  },
  RequestInterrupted(state, payload, event) {
    if ('raw' in payload) return;
    const row = request(state, payload.requestId, payload.sessionId);
    latest(row, 'interrupted', event, () => { row.interruptedResetId = payload.resetId ?? null; });
    status(row);
  },
});
