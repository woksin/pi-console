import type { AttentionItem, AttentionReason, Session, SourcePointer } from '@pi-console/contract';
import { age, clip, compactNumber, money, sanitize, sparkline } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export interface OverviewInput { needsYou: readonly AttentionItem[]; sessions: readonly Session[]; repositories: number; now: number }
export interface AttentionCard {
  id: string; reason: AttentionReason; reasonLabel: string; status: StatusCell; title: string; text: string;
  age: string; sessionId: string | null; pointer: SourcePointer | null;
}
export interface OverviewViewModel {
  headline: string;
  /** The daemon's `/needs-you` list in the daemon's order. The client never filters or re-ranks it. */
  cards: AttentionCard[];
  counts: { status: StatusCell; count: number }[];
  fleet: { sessions: number; repositories: number; working: number; tokens: string; cost: string; contextSeries: number[]; contextSpark: string };
}

const reasons: Record<AttentionReason, { label: string; status: string }> = {
  'open-request': { label: 'Open request', status: 'open' },
  'answer-possibly-unseen': { label: 'Answer possibly unseen', status: 'unanswered' },
  'blocking-question': { label: 'Blocking question', status: 'needs-you' },
  'lane-waiting-on-user': { label: 'Lane waiting on you', status: 'waiting' },
  'stale-session': { label: 'Stale session', status: 'idle' },
};
const order = ['needs-you', 'blocked', 'failed', 'working', 'waiting', 'idle', 'done'] as const;

const title = (item: AttentionItem, sessions: ReadonlyMap<string, Session>): string => {
  const session = item.sessionId ? sessions.get(item.sessionId) : undefined;
  return session ? `${session.repositoryId}/${session.laneId}` : (item.laneId ?? 'fleet');
};

function fleetSummary(sessions: readonly Session[], repositories: number): OverviewViewModel['fleet'] {
  const length = Math.max(0, ...sessions.map(session => session.samples.length));
  const contextSeries = Array.from({ length }, (_, index) => {
    const values = sessions.flatMap(session => (session.samples[index] ? [session.samples[index].contextPercent] : []));
    return Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  });
  const samples = sessions.flatMap(session => session.samples);
  return {
    sessions: sessions.length, repositories, working: sessions.filter(session => session.status === 'working').length,
    tokens: compactNumber(samples.reduce((sum, sample) => sum + sample.tokens, 0)),
    cost: money(samples.reduce((sum, sample) => sum + sample.costUsd, 0)),
    contextSeries, contextSpark: sparkline(contextSeries, 100),
  };
}

export function overviewViewModel(input: OverviewInput): OverviewViewModel {
  const byId = new Map(input.sessions.map(session => [session.id, session]));
  const cards = input.needsYou.map(item => ({
    id: item.id, reason: item.reason, reasonLabel: reasons[item.reason].label, status: statusCell(reasons[item.reason].status),
    title: title(item, byId), text: clip(sanitize(item.text), 160), age: age(item.since, input.now), sessionId: item.sessionId, pointer: item.pointer,
  }));
  const counts = order.map(status => ({ status: statusCell(status), count: input.sessions.filter(session => session.status === status).length }));
  const headline = cards.length === 0 ? 'All clear: nothing needs you' : `${String(cards.length)} ${cards.length === 1 ? 'thing needs' : 'things need'} you`;
  return { headline, cards, counts, fleet: fleetSummary(input.sessions, input.repositories) };
}
