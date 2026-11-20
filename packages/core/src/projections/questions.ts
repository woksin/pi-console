import type { EventEnvelope, SourceRef } from '@pi-console/contract';
import { entry, orderKey, projection } from '../projector/handlers.ts';

export interface QuestionModel {
  id: string;
  asker: string | null;
  kind: 'question' | 'decision' | 'approval' | 'fyi';
  text: string;
  options: string[];
  urgency: 'normal' | 'high';
  blocking: boolean;
  status: 'open' | 'answered' | 'deferred' | 'closed';
  createdAt: string;
  ref: SourceRef | null;
  stamps: Record<string, string>;
}

export interface QuestionsState { questions: Record<string, QuestionModel> }

function question(state: QuestionsState, id: string): QuestionModel {
  return entry(state.questions, id, () => ({
    id, asker: null, kind: 'question', text: '', options: [], urgency: 'normal', blocking: false,
    status: 'open', createdAt: '', ref: null, stamps: Object.create(null) as Record<string, string>,
  }));
}

function update(row: QuestionModel, field: string, event: EventEnvelope, apply: () => void): void {
  const key = orderKey(event);
  if (key < (row.stamps[field] ?? '')) return;
  apply();
  row.stamps[field] = key;
}

const setStatus = (status: QuestionModel['status']) => (state: QuestionsState, payload: { questionId: string }, event: EventEnvelope) => {
  const row = question(state, payload.questionId);
  update(row, 'status', event, () => { row.status = status; });
};

export const questionsProjection = projection<QuestionsState>('questions', 2, () => ({ questions: {} }), {
  QuestionAsked(state, payload, event) {
    const row = question(state, payload.questionId);
    update(row, 'asked', event, () => {
      Object.assign(row, { asker: payload.asker ?? null, kind: payload.kind, options: payload.options ?? [],
        urgency: payload.urgency, blocking: payload.blocking, createdAt: event.occurredAt, ref: event.refs });
    });
    update(row, 'text', event, () => { row.text = payload.excerpt ?? ''; });
    setStatus('open')(state, payload, event);
  },
  QuestionRevised(state, payload, event) {
    const text = payload.excerpt;
    if (text === undefined) return;
    const row = question(state, payload.questionId);
    update(row, 'text', event, () => { row.text = text; });
  },
  QuestionAnswered: setStatus('answered'),
  QuestionDeferred: setStatus('deferred'),
  QuestionClosed: setStatus('closed'),
});
