import type { Question } from '@pi-console/contract';
import { matches, parseFilter } from '../common/filter.ts';
import { age, badge, clean, clip, type Badge } from '../common/format.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export type QuestionFilter = 'open' | 'blocking' | 'answered' | 'all';

export const questionFilters: readonly { id: QuestionFilter; label: string }[] = [
  { id: 'open', label: 'Open' }, { id: 'blocking', label: 'Blocking' }, { id: 'answered', label: 'Answered' }, { id: 'all', label: 'All' },
];

export interface QuestionContext { filter?: QuestionFilter; search?: string; selectedId?: string | null }

export interface QuestionRow {
  id: string; sessionId: string; session: string; kind: Question['kind']; urgency: Question['urgency']; blocking: boolean;
  status: Question['status']; badge: Badge; text: string; age: string; optionCount: number;
}

export interface QuestionDetail extends QuestionRow {
  verbatim: string;
  options: { key: string; text: string }[];
  /** Answering is a control feature (M4); the detail says so instead of hiding the options. */
  readOnlyNote: string;
}

export interface QuestionsViewModel {
  filter: QuestionFilter; search: string;
  tabs: { id: QuestionFilter; label: string; count: number }[];
  heading: string; rows: QuestionRow[]; selected: QuestionDetail | null; empty: boolean; emptyText: string;
}

const accepts = (filter: QuestionFilter, question: Question): boolean => {
  if (filter === 'all') return true;
  if (filter === 'blocking') return question.blocking && question.status === 'open';
  return question.status === filter;
};

const keys = 'abcdefghij';

function row(state: ConsoleState, question: Question): QuestionRow {
  const needs = question.blocking && question.status === 'open';
  return {
    id: question.id, sessionId: question.sessionId, session: sessionLabel(state, question.sessionId), kind: question.kind,
    urgency: question.urgency, blocking: question.blocking, status: question.status,
    badge: badge(needs ? 'needs-you' : question.status === 'answered' ? 'answered' : 'idle'),
    text: clip(question.text, 140), age: age(state.liveAt, question.createdAt), optionCount: question.options.length,
  };
}

export function buildQuestions(state: ConsoleState, context: QuestionContext = {}): QuestionsViewModel {
  const filter = context.filter ?? 'open';
  const search = context.search ?? '';
  const parsed = parseFilter(search);
  const urgentFirst = (a: Question, b: Question) => Number(b.blocking) - Number(a.blocking) || Number(b.urgency === 'high') - Number(a.urgency === 'high') || b.createdAt.localeCompare(a.createdAt);
  const visible = state.questions.filter(question => accepts(filter, question) && matches(parsed, `${question.text} ${question.id} ${question.kind}`)).toSorted(urgentFirst);
  const chosen = visible.find(question => question.id === context.selectedId) ?? visible.at(0);
  const open = state.questions.filter(question => question.status === 'open');
  return {
    filter, search,
    tabs: questionFilters.map(tab => ({ ...tab, count: state.questions.filter(question => accepts(tab.id, question)).length })),
    heading: `open ${String(open.length)}  blocking ${String(open.filter(question => question.blocking).length)}`,
    rows: visible.map(question => row(state, question)),
    selected: chosen ? {
      ...row(state, chosen), verbatim: clean(chosen.text),
      options: chosen.options.map((text, index) => ({ key: keys[index] ?? '', text: clip(text, 120) })),
      readOnlyNote: 'Answering from the console arrives with control features; answer in the owning session for now.',
    } : null,
    empty: visible.length === 0, emptyText: 'No open questions. Agents ask here when they need you.',
  };
}
