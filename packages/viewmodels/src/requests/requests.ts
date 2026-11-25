import type { Request, RequestEvidence, Session } from '@pi-console/contract';
import type { Action } from '../keymap/keymap.ts';
import { age, sanitize } from '../format/format.ts';
import { sessionLabels, type SessionLabel } from '../format/session-labels.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

/**
 * Display model of Requests and answers over the derived `Request` records (docs/requests.md). Stored text is data:
 * rows carry it single-line encoded and the detail as sanitized lines, so it can never forge headings, labels or
 * terminal control. Origin is "classified as", never "verified", and an uncertain pairing always says so.
 */
export type RequestStateFilter = 'all' | 'open' | 'answered' | 'unanswered' | 'interrupted' | 'uncertain' | 'possibly-unseen';
export type RequestOriginFilter = 'all' | Request['origin'];
export interface RequestsFilter { state?: RequestStateFilter; origin?: RequestOriginFilter; sessionId?: string | null; query?: string }

export const requestStateFilters: readonly RequestStateFilter[] = ['all', 'open', 'answered', 'unanswered', 'interrupted', 'uncertain', 'possibly-unseen'];
export const requestOriginFilters: readonly RequestOriginFilter[] = ['all', 'human', 'launch', 'unproven'];

/** Where to open the transcript; the file offset is known for the prompt only. */
export interface TranscriptLink { sessionId: string; entryId: string; fileOffset: number | null }
export interface Excerpt { text: string; withheld: boolean; age: string }
export interface RequestsRow {
  id: string; sessionId: string; session: SessionLabel; origin: Request['origin']; originLabel: string; status: StatusCell;
  text: string; withheld: boolean; age: string; answer: Excerpt | null;
  /** Shown beside the status whenever the pairing is heuristic; `null` when it is not. */
  uncertain: string | null;
  possiblyUnseen: StatusCell | null;
  source: string;
  /** Opens the transcript at the prompt. */
  transcript: TranscriptLink | null;
}
export interface EvidenceRow { label: string; at: string; age: string; transcript: TranscriptLink | null; resetId: string | null }
export interface RequestDetail extends RequestsRow {
  provenance: string; provenanceQualifier: string; originEvidence: string; textLines: string[]; answerLines: string[]; interim: Excerpt[]; evidence: EvidenceRow[];
}
export interface RequestsViewModel {
  rows: RequestsRow[]; open: number; uncertain: number; possiblyUnseen: number;
  filter: Required<RequestsFilter>; sessions: { id: string; name: string }[];
}

export const uncertainLabels: Record<NonNullable<Request['uncertainReason']>, string> = {
  'shared-answer': 'Uncertain: one answer followed several prompts',
  'reset-then-new-prompt': 'Uncertain: a reset came between this request and a newer prompt',
};
const evidenceLabels: Record<RequestEvidence['kind'], string> = {
  prompt: 'Prompt', answer: 'Answer', 'later-prompt': 'Another prompt before the answer', abort: 'Aborted',
  reset: 'Reset while open', boundary: 'Reset right after the answer', 'session-end': 'Session ended', explicit: 'Stated by the source',
};
const sourceLabels: Record<NonNullable<Request['derivedFrom']>, string> = {
  'session-jsonl': 'Derived from the session transcript', 'intent-memory': 'From the intent-memory store',
};
const withheldText = '[withheld]';

/** Stored text as one line: control stripped, line breaks shown as ⏎ so the text cannot start a line of its own. */
export const singleLine = (text: string): string => sanitize(text).replace(/\r?\n/g, ' ⏎ ');

const shown = (text: string, withheld: boolean) => (withheld ? withheldText : singleLine(text));
const lines = (text: string, withheld: boolean) => (withheld ? [withheldText] : sanitize(text).split(/\r?\n/));

const pointerOf = (request: Request): TranscriptLink | null => request.pointer ?? null;

function matchesState(request: Request, state: RequestStateFilter): boolean {
  if (state === 'all') return true;
  if (state === 'uncertain') return request.uncertain === true;
  if (state === 'possibly-unseen') return request.answerPossiblyUnseen === true;
  return request.status === state;
}

const matches = (request: Request, filter: Required<RequestsFilter>, names: ReadonlyMap<string, SessionLabel>) =>
  matchesState(request, filter.state) && (filter.origin === 'all' || request.origin === filter.origin)
  && (filter.sessionId === null || request.sessionId === filter.sessionId) && matchesQuery(request, filter.query, names);

/** Free-text filter over what a row shows: request text, session name, origin label and state. Withheld text is never searched. */
function matchesQuery(request: Request, query: string, names: ReadonlyMap<string, SessionLabel>): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return true;
  const text = request.withheld === true ? '' : request.text;
  return `${text} ${names.get(request.sessionId)?.title ?? request.sessionId} ${request.originLabel} ${request.status}`.toLowerCase().includes(wanted);
}

function row(request: Request, names: ReadonlyMap<string, SessionLabel>, now: number): RequestsRow {
  const answer = request.answer;
  return {
    id: request.id, sessionId: request.sessionId, session: names.get(request.sessionId) ?? { name: request.sessionId, lane: '', title: request.sessionId },
    origin: request.origin, originLabel: request.originLabel, status: statusCell(request.status),
    text: shown(request.text, request.withheld === true), withheld: request.withheld === true, age: age(request.createdAt, now),
    answer: answer ? { text: shown(answer.text, request.answerWithheld === true), withheld: request.answerWithheld === true, age: age(answer.at, now) } : null,
    uncertain: request.uncertainReason ? uncertainLabels[request.uncertainReason] : null,
    possiblyUnseen: request.answerPossiblyUnseen ? statusCell('answer-possibly-unseen') : null,
    source: request.derivedFrom ? sourceLabels[request.derivedFrom] : 'Reported by the source',
    transcript: pointerOf(request),
  };
}

const sessionNames = (sessions: readonly Session[]) => new Map(sessions.map(session => [session.id, sessionLabels(session)]));

export function requestsViewModel(input: { requests: readonly Request[]; sessions: readonly Session[]; now: number; filter?: RequestsFilter }): RequestsViewModel {
  const filter: Required<RequestsFilter> = { state: input.filter?.state ?? 'all', origin: input.filter?.origin ?? 'all', sessionId: input.filter?.sessionId ?? null, query: input.filter?.query ?? '' };
  const names = sessionNames(input.sessions);
  const rows = input.requests.filter(request => matches(request, filter, names))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .map(request => row(request, names, input.now));
  const count = (state: RequestStateFilter) => input.requests.filter(request => matchesState(request, state)).length;
  const sessionIds = [...new Set(input.requests.map(request => request.sessionId))].sort();
  return {
    rows, open: count('open') + count('unanswered'), uncertain: count('uncertain'), possiblyUnseen: count('possibly-unseen'), filter,
    sessions: sessionIds.map(id => ({ id, name: names.get(id)?.title ?? id })),
  };
}

/** The filter axes both clients cycle with the same keys: `[` `]` state, `o` origin, `S` session (see the keymap). */
export type RequestFilterAxis = 'state' | 'origin' | 'session';
const filterActions: Partial<Record<Action, { axis: RequestFilterAxis; step: 1 | -1 }>> = {
  'filter.next': { axis: 'state', step: 1 }, 'filter.previous': { axis: 'state', step: -1 },
  'filter.origin': { axis: 'origin', step: 1 }, 'filter.session': { axis: 'session', step: 1 },
};
export const requestFilterAction = (action: Action) => filterActions[action] ?? null;

const stepped = <T>(options: readonly T[], current: T, step: number): T => options[(Math.max(0, options.indexOf(current)) + step + options.length) % options.length];

/** Moves one axis to its next or previous value, wrapping; the session axis runs through `all` and the sessions that have requests. */
export function cycleRequestFilter(filter: Required<RequestsFilter>, axis: RequestFilterAxis, sessionIds: readonly string[], step: 1 | -1): Required<RequestsFilter> {
  if (axis === 'state') return { ...filter, state: stepped(requestStateFilters, filter.state, step) };
  if (axis === 'origin') return { ...filter, origin: stepped(requestOriginFilters, filter.origin, step) };
  return { ...filter, sessionId: stepped<string | null>([null, ...sessionIds], filter.sessionId, step) };
}

/** One line saying which filters are on, e.g. `state open · origin launch · session all`. */
export function describeRequestFilter(model: RequestsViewModel): string {
  const session = model.sessions.find(item => item.id === model.filter.sessionId);
  const query = model.filter.query.trim() === '' ? '' : ` · “${singleLine(model.filter.query.trim())}”`;
  return `state ${model.filter.state} · origin ${model.filter.origin} · session ${model.filter.sessionId === null ? 'all' : session?.name ?? model.filter.sessionId}${query}`;
}

/** Keep classification short without implying that the transcript proves who sent the prompt. */
function provenance(request: Request): string {
  const sources = { 'session-jsonl': 'classified from transcript', 'intent-memory': 'reported by intent-memory' };
  const source = request.derivedFrom ? sources[request.derivedFrom] : 'reported by source';
  const claim = request.origin === 'unproven' ? 'Origin not proven' : request.originLabel;
  return `${claim} · ${source}`;
}

function evidenceRow(item: RequestEvidence, sessionId: string, now: number): EvidenceRow {
  return {
    label: evidenceLabels[item.kind], at: item.at, age: age(item.at, now), resetId: item.resetId,
    transcript: item.entryId ? { sessionId, entryId: item.entryId, fileOffset: null } : null,
  };
}

/** The detail pane: full text as lines, the evidence trail behind the state, and links into the transcript. */
export function requestDetail(input: { request: Request; sessions: readonly Session[]; now: number }): RequestDetail {
  const { request, now } = input;
  return {
    ...row(request, sessionNames(input.sessions), now),
    provenance: provenance(request), provenanceQualifier: 'not verified',
    originEvidence: singleLine(request.originEvidence),
    textLines: lines(request.text, request.withheld === true),
    answerLines: request.answer ? lines(request.answer.text, request.answerWithheld === true) : [],
    interim: request.interimAnswers.map(answer => ({ text: singleLine(answer.text), withheld: false, age: age(answer.at, now) })),
    evidence: (request.evidence ?? []).map(item => evidenceRow(item, request.sessionId, now)),
  };
}
