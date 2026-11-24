import type { AttentionItem, AttentionReason, Session, SourcePointer } from '@pi-console/contract';
import { age, clip, compactNumber, sanitize, sparkline } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';
import { sessionLabels } from '../format/session-labels.ts';
import { fleetCostLabel } from '../format/session-cost.ts';
import { emptyStates } from '../empty/empty.ts';

export interface OverviewInput { needsYou: readonly AttentionItem[]; sessions: readonly Session[]; repositories: number; now: number }
export interface AttentionCard {
  id: string; reason: AttentionReason; reasonLabel: string; status: StatusCell; title: string; text: string;
  age: string; sessionId: string | null; pointer: SourcePointer | null;
}
export interface OverviewViewModel {
  headline: string;
  /** Fixed reason priority, newest first within each reason. */
  cards: AttentionCard[];
  counts: { status: StatusCell; count: number }[];
  fleet: { sessions: number; repositories: number; working: number; tokens: string; cost: string; contextSeries: number[]; contextSpark: string };
}

// Human replies first, then lane and memory actions, then passive staleness. Unknown reasons sort last.
const reasonOrder: string[] = ['blocking-question', 'open-request', 'answer-possibly-unseen', 'lane-waiting-on-user', 'proposed-memory', 'stale-session'];
const reasonPriority = (reason: string): number => {
  const index = reasonOrder.indexOf(reason);
  return index < 0 ? reasonOrder.length : index;
};

const pluralLabels: Readonly<Record<string, string>> = {
  'Open request': 'Open requests', 'Blocking question': 'Blocking questions', 'Stale session': 'Stale sessions', 'Proposed memory': 'Proposed memories',
  'Lane waiting on you': 'Lanes waiting on you',
};
const sectionLabel = (label: string, count: number): string => (count === 1 ? label : pluralLabels[label] ?? label);

/** One section per reason, in fixed priority order; retain the supplied order within each reason. Headings are plural unless the count is one. */
export function attentionSections<T extends { reason: string; reasonLabel: string }>(cards: readonly T[]): { label: string; cards: T[] }[] {
  return [...Map.groupBy(cards, card => card.reason)]
    .sort(([left], [right]) => reasonPriority(left) - reasonPriority(right))
    .map(([, group]) => ({ label: sectionLabel(group[0].reasonLabel, group.length), cards: group }));
}

const reasons: Record<AttentionReason, { label: string; status: string }> = {
  'open-request': { label: 'Open request', status: 'open' },
  'answer-possibly-unseen': { label: 'Possibly unseen', status: 'answer-possibly-unseen' },
  'blocking-question': { label: 'Blocking question', status: 'needs-you' },
  'lane-waiting-on-user': { label: 'Lane waiting on you', status: 'waiting' },
  'stale-session': { label: 'Stale session', status: 'idle' },
  'proposed-memory': { label: 'Proposed memory', status: 'needs-you' },
};
const order = ['needs-you', 'blocked', 'failed', 'working', 'waiting', 'idle', 'done'] as const;

const title = (item: AttentionItem, sessions: ReadonlyMap<string, Session>): string => {
  const session = item.sessionId ? sessions.get(item.sessionId) : undefined;
  return session ? sessionLabels(session).attention : (item.laneId ?? 'fleet');
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
    cost: fleetCostLabel(sessions),
    contextSeries, contextSpark: sparkline(contextSeries, 100),
  };
}

export function overviewViewModel(input: OverviewInput): OverviewViewModel {
  const byId = new Map(input.sessions.map(session => [session.id, session]));
  const recent = input.needsYou.toSorted((left, right) => Date.parse(right.since) - Date.parse(left.since));
  const cards = recent.map(item => ({
    id: item.id, reason: item.reason, reasonLabel: reasons[item.reason].label, status: statusCell(reasons[item.reason].status),
    title: title(item, byId), text: clip(sanitize(item.text), 160), age: age(item.since, input.now), sessionId: item.sessionId, pointer: item.pointer,
  }));
  const counts = order.map(status => ({ status: statusCell(status), count: input.sessions.filter(session => session.status === status).length }));
  const calmHeadline = input.sessions.length === 0 ? emptyStates.fleet.title : 'All clear: nothing needs you';
  const headline = cards.length === 0 ? calmHeadline : `${String(cards.length)} ${cards.length === 1 ? 'thing needs' : 'things need'} you`;
  return { headline, cards: attentionSections(cards).flatMap(section => section.cards), counts, fleet: fleetSummary(input.sessions, input.repositories) };
}
