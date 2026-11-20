import type { Request } from '@pi-console/contract';
import { matches, parseFilter } from '../common/filter.ts';
import { age, badge, clean, clip, clock, type Badge } from '../common/format.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export type RequestFilter = 'all' | 'unanswered' | 'interrupted' | 'unseen' | 'open';

export const requestFilters: readonly { id: RequestFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'open', label: 'Open' }, { id: 'unanswered', label: 'Unanswered' },
  { id: 'interrupted', label: 'Interrupted' }, { id: 'unseen', label: 'Answer possibly unseen' },
];

export interface RequestContext { filter?: RequestFilter; search?: string; selectedId?: string | null }

export interface RequestRow {
  id: string;
  sessionId: string;
  session: string;
  badge: Badge;
  /** Status text; adds the "possibly unseen" qualifier where the daemon's attention list says so. */
  statusText: string;
  origin: string;
  text: string;
  age: string;
  answerExcerpt: string | null;
}

export interface RequestDetail extends RequestRow {
  verbatim: string;
  originEvidence: string;
  /** True for origins that are not proven human requests; P5 adds a per-state `uncertain` flag on top. */
  uncertain: boolean;
  answer: { text: string; at: string; interim: boolean } | null;
  interimAnswers: { text: string; at: string }[];
  boundary: { kind: string; at: string; carried: number; interrupted: number } | null;
  /** Transcript position of the request, for exact navigation. */
  entryId: string | null;
}

export interface RequestsViewModel {
  filter: RequestFilter;
  search: string;
  tabs: { id: RequestFilter; label: string; count: number }[];
  rows: RequestRow[];
  selected: RequestDetail | null;
  total: number;
  empty: boolean;
}

const unseenIds = (state: ConsoleState): Set<string> => new Set(
  state.needsYou.filter(item => item.reason === 'answer-possibly-unseen').flatMap(item => state.requests
    .filter(request => request.id === item.id.replace(/^need-/, '') || (request.sessionId === item.sessionId && request.text === item.text))
    .map(request => request.id)),
);

const accepts = (filter: RequestFilter, request: Request, unseen: Set<string>): boolean => {
  if (filter === 'all') return true;
  if (filter === 'unseen') return unseen.has(request.id);
  return request.status === filter;
};

function row(state: ConsoleState, request: Request, unseen: Set<string>): RequestRow {
  const answer = request.answer;
  return {
    id: request.id, sessionId: request.sessionId, session: sessionLabel(state, request.sessionId),
    badge: badge(unseen.has(request.id) ? 'interrupted' : request.status),
    statusText: unseen.has(request.id) ? 'answered, possibly unseen' : request.status,
    origin: request.originLabel, text: clip(request.text, 160), age: age(state.liveAt, request.createdAt),
    answerExcerpt: answer ? clip(answer.text, 200) : null,
  };
}

function detail(state: ConsoleState, request: Request, unseen: Set<string>): RequestDetail {
  const reset = request.resetId ? state.resets.find(item => item.id === request.resetId) : undefined;
  const entry = state.transcripts[request.sessionId]?.find(item => item.requestId === request.id);
  return {
    ...row(state, request, unseen), verbatim: clean(request.text), originEvidence: clean(request.originEvidence),
    uncertain: request.origin === 'unproven',
    answer: request.answer ? { text: clean(request.answer.text), at: clock(request.answer.at), interim: request.answer.interim } : null,
    interimAnswers: request.interimAnswers.map(item => ({ text: clean(item.text), at: clock(item.at) })),
    boundary: reset ? { kind: reset.kind, at: clock(reset.at), carried: reset.carriedRequestIds.length, interrupted: reset.interruptedRequestIds.length } : null,
    entryId: entry?.id ?? null,
  };
}

export function buildRequests(state: ConsoleState, context: RequestContext = {}): RequestsViewModel {
  const filter = context.filter ?? 'all';
  const search = context.search ?? '';
  const unseen = unseenIds(state);
  const parsed = parseFilter(search);
  const newestFirst = state.requests.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const visible = newestFirst.filter(request => accepts(filter, request, unseen)
    && matches(parsed, `${request.text} ${request.id} ${sessionLabel(state, request.sessionId)}`));
  const chosen = visible.find(request => request.id === context.selectedId) ?? visible.at(0);
  return {
    filter, search,
    tabs: requestFilters.map(tab => ({ ...tab, count: state.requests.filter(request => accepts(tab.id, request, unseen)).length })),
    rows: visible.map(request => row(state, request, unseen)),
    selected: chosen ? detail(state, chosen, unseen) : null,
    total: state.requests.length, empty: state.requests.length === 0,
  };
}
