import type { SourceRef } from '@pi-console/contract';
import { projection } from '../projector/handlers.ts';

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
}

export interface QuestionsState { questions: Record<string, QuestionModel> }

const setStatus = (status: QuestionModel['status']) => (state: QuestionsState, payload: { questionId: string }) => {
  const question = state.questions[payload.questionId] as QuestionModel | undefined;
  if (question) question.status = status;
};

export const questionsProjection = projection<QuestionsState>('questions', 1, () => ({ questions: {} }), {
  QuestionAsked(state, payload, event) {
    state.questions[payload.questionId] = {
      id: payload.questionId, asker: payload.asker ?? null, kind: payload.kind, text: payload.excerpt ?? '', options: payload.options ?? [],
      urgency: payload.urgency, blocking: payload.blocking, status: 'open', createdAt: event.occurredAt, ref: event.refs,
    };
  },
  QuestionRevised(state, payload) {
    const question = state.questions[payload.questionId] as QuestionModel | undefined;
    if (question && payload.excerpt !== undefined) question.text = payload.excerpt;
  },
  QuestionAnswered: setStatus('answered'),
  QuestionDeferred: setStatus('deferred'),
  QuestionClosed: setStatus('closed'),
});
