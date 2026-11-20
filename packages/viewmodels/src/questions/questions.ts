import type { Question, Session } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export interface QuestionRow {
  id: string; sessionId: string; session: string; kind: Question['kind']; urgent: boolean; blocking: boolean; status: StatusCell;
  text: string; options: string[]; age: string;
}
export interface QuestionsViewModel { rows: QuestionRow[]; open: number; blocking: number }

const rank = (question: Question) => (question.status === 'open' ? 0 : 1) * 4 + (question.blocking ? 0 : 2) + (question.urgency === 'high' ? 0 : 1);

/** Read-only queue: blocking and high urgency first; answered and closed questions sink. */
export function questionsViewModel(input: { questions: readonly Question[]; sessions: readonly Session[]; now: number }): QuestionsViewModel {
  const names = new Map(input.sessions.map(session => [session.id, session.name]));
  const rows = [...input.questions].sort((a, b) => rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt)).map(question => ({
    id: question.id, sessionId: question.sessionId, session: names.get(question.sessionId) ?? question.sessionId, kind: question.kind,
    urgent: question.urgency === 'high', blocking: question.blocking, status: statusCell(question.status === 'open' ? (question.blocking ? 'needs-you' : 'open') : 'done'),
    text: sanitize(question.text), options: question.options.map(sanitize), age: age(question.createdAt, input.now),
  }));
  const open = input.questions.filter(question => question.status === 'open');
  return { rows, open: open.length, blocking: open.filter(question => question.blocking).length };
}
