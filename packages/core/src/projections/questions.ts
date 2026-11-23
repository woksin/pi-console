import type { EventEnvelope, SourceRef } from '@pi-console/contract';
import { entry, markDirty, orderKey, projection } from '../projector/handlers.ts';

/** One recorded history entry; the sequence is the source's per-question identity. */
export interface QuestionHistoryModel { sequence: number; operation: string; at: string; actor: string | null; excerpt?: string; withheld: boolean }

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
  /** Highest source revision applied; 0 until a snapshot supplies current state. */
  revision: number;
  updatedAt: string;
  links: string[];
  /** Present only once the source supplied history; keyed by sequence so any arrival order converges. */
  history: Record<string, QuestionHistoryModel> | null;
  stamps: Record<string, string>;
}

export interface QuestionsState { questions: Record<string, QuestionModel> }

function question(state: QuestionsState, id: string): QuestionModel {
  markDirty(state, 'questions', id);
  return entry(state.questions, id, () => ({
    id, asker: null, kind: 'question', text: '', options: [], urgency: 'normal', blocking: false,
    status: 'open', createdAt: '', ref: null, revision: 0, updatedAt: '', links: [], history: null, stamps: Object.create(null) as Record<string, string>,
  }));
}

const snapshotFields = new Set(['asked', 'text', 'status']);

function update(row: QuestionModel, field: string, event: EventEnvelope, apply: () => void): void {
  if (row.revision > 0 && snapshotFields.has(field)) return; // A snapshot is authoritative for current state.
  const key = orderKey(event);
  if (key < (row.stamps[field] ?? '')) return;
  apply();
  row.stamps[field] = key;
}

const setStatus = (status: QuestionModel['status']) => (state: QuestionsState, payload: { questionId: string }, event: EventEnvelope) => {
  const row = question(state, payload.questionId);
  update(row, 'status', event, () => { row.status = status; });
};

export const questionsProjection = projection<QuestionsState>('questions', 4, () => ({ questions: {} }), {
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
  QuestionSnapshotObserved(state, payload, event) {
    const row = question(state, payload.questionId);
    if (payload.revision < row.revision) return;
    Object.assign(row, {
      asker: payload.asker ?? null, kind: payload.kind, text: payload.excerpt ?? '', options: payload.options ?? [], urgency: payload.urgency,
      blocking: payload.blocking, status: payload.status, createdAt: payload.createdAt, updatedAt: payload.updatedAt, links: payload.links ?? [],
      revision: payload.revision, ref: event.refs,
    });
  },
  QuestionHistoryRecorded(state, payload) {
    const row = question(state, payload.questionId);
    row.history ??= Object.create(null) as Record<string, QuestionHistoryModel>;
    const { sequence, operation, at, actor, excerpt, withheld } = payload;
    Object.defineProperty(row.history, String(sequence), {
      value: { sequence, operation, at, actor, withheld: withheld ?? false, ...(excerpt === undefined ? {} : { excerpt }) },
      writable: true, enumerable: true, configurable: true,
    });
  },
  QuestionAnswered: setStatus('answered'),
  QuestionDeferred: setStatus('deferred'),
  QuestionClosed: setStatus('closed'),
}, ['questions']);
