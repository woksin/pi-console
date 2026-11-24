import type { Request, Session } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';
import { sessionLabels } from '../format/session-labels.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

/**
 * Display model of the Requests and answers list. P5 owns the derivation (pairing, uncertain-state labels) and replaces
 * this slot with `viewmodels/src/requests`; until then it shows the API's `Request` records exactly as given, never
 * presenting a launch or unproven prompt as the human's words (the API's `originLabel` is shown verbatim).
 */
export interface RequestRow {
  id: string; sessionId: string; session: string; originLabel: string; originEvidence: string; status: StatusCell; text: string;
  answer: { text: string; age: string } | null; partial: { text: string; age: string } | null; resetId: string | null; age: string;
}
export interface RequestListViewModel { rows: RequestRow[]; open: number }

const bySession = (sessions: readonly Session[]) => new Map(sessions.map(session => [session.id, sessionLabels(session).title]));

export function requestListViewModel(input: { requests: readonly Request[]; sessions: readonly Session[]; now: number; filter?: string }): RequestListViewModel {
  const names = bySession(input.sessions);
  const wanted = input.filter && input.filter !== 'all' ? input.requests.filter(request => request.status === input.filter) : input.requests;
  const rows = [...wanted].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(request => ({
    id: request.id, sessionId: request.sessionId, session: names.get(request.sessionId) ?? request.sessionId,
    originLabel: request.originLabel, originEvidence: sanitize(request.originEvidence), status: statusCell(request.status),
    text: sanitize(request.text), age: age(request.createdAt, input.now),
    answer: request.answer ? { text: sanitize(request.answer.text), age: age(request.answer.at, input.now) } : null,
    partial: request.interimAnswers[0] ? { text: sanitize(request.interimAnswers[0].text), age: age(request.interimAnswers[0].at, input.now) } : null,
    resetId: request.resetId,
  }));
  return { rows, open: input.requests.filter(request => request.status === 'open' || request.status === 'unanswered').length };
}
