import type { AttentionItem, AttentionReason, Question, Request } from '@pi-console/contract';
import { age, badge, clip, median, money, plural, sparkline, type Badge } from '../common/format.ts';
import { summarise, type SessionSummary } from '../common/sessions.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export const reasonLabels: Record<AttentionReason, string> = {
  'open-request': 'Open request',
  'answer-possibly-unseen': 'Answer possibly unseen',
  'blocking-question': 'Blocking question',
  'lane-waiting-on-user': 'Waiting on you',
  'stale-session': 'Stale session',
};

const reasonStatus: Record<AttentionReason, string> = {
  'open-request': 'needs-you', 'answer-possibly-unseen': 'needs-you', 'blocking-question': 'needs-you',
  'lane-waiting-on-user': 'waiting', 'stale-session': 'blocked',
};

/** Inline actions are shown but disabled: M1 is read-only (docs/milestones.md). */
export interface CardAction { key: string; label: string; enabled: boolean; why: string }

export interface NeedCard {
  id: string;
  reason: AttentionReason;
  reasonLabel: string;
  badge: Badge;
  title: string;
  text: string;
  session: { id: string; label: string } | null;
  age: string;
  /** Exact transcript position, when the daemon supplied one. */
  pointer: AttentionItem['pointer'];
  question: { id: string; kind: Question['kind']; urgency: Question['urgency']; blocking: boolean; options: { key: string; text: string }[] } | null;
  request: { id: string; origin: string; status: string } | null;
  actions: CardAction[];
}

export interface OverviewViewModel {
  headline: string;
  empty: boolean;
  needs: NeedCard[];
  blocked: SessionSummary[];
  working: { count: number; total: number; ratio: number; ratioText: string; contextMedian: number; cost: string; tokenTrend: number[]; tokenTrendText: string; sessions: SessionSummary[] };
  host: { label: string; value: string }[];
}

const readOnly = 'Read-only in M1';

const idOf = (item: AttentionItem): string => item.id.replace(/^need-/, '');

function findQuestion(state: ConsoleState, item: AttentionItem): Question | undefined {
  if (item.reason !== 'blocking-question') return undefined;
  return state.questions.find(question => question.id === idOf(item) || (question.sessionId === item.sessionId && question.text === item.text));
}

function findRequest(state: ConsoleState, item: AttentionItem): Request | undefined {
  if (item.reason !== 'open-request' && item.reason !== 'answer-possibly-unseen') return undefined;
  return state.requests.find(request => request.id === idOf(item) || (request.sessionId === item.sessionId && request.text === item.text));
}

const optionKeys = 'abcdefghij';

function actionsFor(question: Question | undefined): CardAction[] {
  if (!question) return [{ key: 'Enter', label: 'Open session', enabled: true, why: '' }];
  const answers = question.options.slice(0, optionKeys.length).map((option, index) => ({ key: optionKeys[index], label: option, enabled: false, why: readOnly }));
  return [...answers, { key: 'd', label: 'Defer', enabled: false, why: readOnly }, { key: 'Enter', label: 'Open session', enabled: true, why: '' }];
}

function card(state: ConsoleState, item: AttentionItem): NeedCard {
  const question = findQuestion(state, item);
  const request = findRequest(state, item);
  const status = request?.status === 'interrupted' ? 'interrupted' : reasonStatus[item.reason];
  return {
    id: item.id, reason: item.reason, reasonLabel: reasonLabels[item.reason], badge: badge(status),
    title: question ? `${question.kind} · ${question.urgency}${question.blocking ? ' · blocking' : ''}` : reasonLabels[item.reason],
    text: clip(item.text, 220), session: item.sessionId ? { id: item.sessionId, label: sessionLabel(state, item.sessionId) } : null,
    age: age(state.liveAt, item.since), pointer: item.pointer,
    question: question ? {
      id: question.id, kind: question.kind, urgency: question.urgency, blocking: question.blocking,
      options: question.options.map((text, index) => ({ key: optionKeys[index] ?? '', text: clip(text, 80) })),
    } : null,
    request: request ? { id: request.id, origin: request.originLabel, status: request.status } : null,
    actions: actionsFor(question),
  };
}

function workingSummary(state: ConsoleState) {
  const working = state.sessions.filter(session => session.status === 'working');
  const total = state.sessions.length;
  const tokens = state.overview?.sparkline.map(point => point.tokens) ?? [];
  const cost = state.overview?.sparkline.reduce((sum, point) => sum + point.costUsd, 0) ?? 0;
  const ratio = total === 0 ? 0 : working.length / total;
  return {
    count: working.length, total, ratio, ratioText: `${String(working.length)}/${String(total)} sessions`,
    contextMedian: median(working.map(session => session.contextPercent)), cost: money(cost),
    tokenTrend: tokens, tokenTrendText: sparkline(tokens), sessions: working.slice(0, 6).map(session => summarise(state, session)),
  };
}

function hostRows(state: ConsoleState): { label: string; value: string }[] {
  const rows = Object.entries(state.health ?? {}).map(([label, value]) => ({ label, value: String(value) }));
  const jobs = state.jobs;
  const running = jobs.filter(job => job.status === 'running').length;
  const queued = jobs.filter(job => job.status === 'queued').length;
  return [{ label: 'Queue', value: `${String(running)} running, ${String(queued)} queued` }, ...rows];
}

function headlineFor(needs: number, working: number): string {
  if (needs > 0) return `${plural(needs, 'item')} need${needs === 1 ? 's' : ''} you`;
  return `Nothing needs you. ${plural(working, 'session')} ${working === 1 ? 'is' : 'are'} working.`;
}

/** Overview ("Needs you"): the attention list comes only from the daemon's `/needs-you`. */
export function buildOverview(state: ConsoleState): OverviewViewModel {
  const needs = state.needsYou.map(item => card(state, item));
  const working = workingSummary(state);
  const blocked = state.sessions.filter(session => (session.status === 'blocked' || session.status === 'failed')).map(session => summarise(state, session));
  return { headline: headlineFor(needs.length, working.count), empty: needs.length === 0, needs, blocked, working, host: hostRows(state) };
}
