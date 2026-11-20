import type { Session } from '@pi-console/contract';
import { age, badge, sparkline, type Badge } from '../common/format.ts';
import { displayStatus, summarise, type SessionSummary } from '../common/sessions.ts';
import { repositoryName, sessionById, sessionLabel, type ConsoleState } from '../state/index.ts';
import { foldEntries, finishRows, type TranscriptRow } from './transcript.ts';

export interface SessionContext {
  expanded?: readonly string[];
  /** Transcript search (`/`). */
  query?: string;
  /** Entry to centre on after a signal-to-transcript jump. */
  targetEntryId?: string | null;
  /** Maximum rows rendered; the window follows the tail, or the target when set. */
  limit?: number;
}

export interface SessionViewModel {
  found: boolean;
  header: (SessionSummary & { cwd: string; parent: string | null; status: Badge }) | null;
  rows: TranscriptRow[];
  hiddenBefore: number;
  matches: number;
  targetFound: boolean;
  rail: {
    requests: { id: string; badge: Badge; text: string; entryId: string | null }[];
    questions: { id: string; badge: Badge; text: string }[];
    subagents: { id: string; label: string; badge: Badge; age: string }[];
    jobs: { id: string; name: string; badge: Badge; age: string }[];
    context: { values: number[]; text: string; resetIndexes: number[] };
  };
}

const empty: SessionViewModel = {
  found: false, header: null, rows: [], hiddenBefore: 0, matches: 0, targetFound: false,
  rail: { requests: [], questions: [], subagents: [], jobs: [], context: { values: [], text: '', resetIndexes: [] } },
};

function windowOf<T extends { id: string }>(rows: T[], limit: number, target: string | null): { rows: T[]; hidden: number } {
  if (rows.length <= limit) return { rows, hidden: 0 };
  const at = target ? rows.findIndex(row => row.id === target) : -1;
  const start = at < 0 ? rows.length - limit : Math.max(0, Math.min(rows.length - limit, at - Math.floor(limit / 2)));
  return { rows: rows.slice(start, start + limit), hidden: start };
}

function contextTrend(state: ConsoleState, session: Session) {
  const values = session.samples.map(sample => sample.contextPercent);
  const resets = state.resets.filter(reset => reset.sessionId === session.id);
  const resetIndexes = resets.map(reset => session.samples.findIndex(sample => sample.at >= reset.at)).filter(index => index >= 0);
  return { values, text: sparkline(values), resetIndexes };
}

function rail(state: ConsoleState, session: Session): SessionViewModel['rail'] {
  const own = <T extends { sessionId: string }>(items: readonly T[]) => items.filter(item => item.sessionId === session.id);
  return {
    requests: own(state.requests).map(request => ({
      id: request.id, badge: badge(request.status), text: request.text.slice(0, 120),
      entryId: state.transcripts[session.id]?.find(entry => entry.requestId === request.id)?.id ?? null,
    })),
    questions: own(state.questions).map(question => ({ id: question.id, badge: badge(question.status === 'open' && question.blocking ? 'needs-you' : question.status), text: question.text.slice(0, 120) })),
    subagents: state.sessions.filter(item => item.parentSessionId === session.id).map(item => ({
      id: item.id, label: sessionLabel(state, item.id), badge: badge(displayStatus(state, item)), age: age(state.liveAt, item.updatedAt),
    })),
    jobs: own(state.jobs).map(job => ({ id: job.id, name: job.name, badge: badge(job.status), age: age(state.liveAt, job.startedAt) })),
    context: contextTrend(state, session),
  };
}

export function buildSession(state: ConsoleState, sessionId: string, context: SessionContext = {}): SessionViewModel {
  const session = sessionById(state, sessionId);
  if (!session) return empty;
  const target = context.targetEntryId ?? null;
  const folded = foldEntries(state.transcripts[sessionId] ?? [], state.resets.filter(reset => reset.sessionId === sessionId));
  const all = finishRows(folded, new Set(context.expanded ?? []), context.query ?? '', target);
  const { rows, hidden } = windowOf(all, context.limit ?? 400, target);
  const parent = session.parentSessionId ? sessionLabel(state, session.parentSessionId) : null;
  return {
    found: true,
    header: { ...summarise(state, session), cwd: `${repositoryName(state, session.repositoryId)} · ${session.cwd}`, parent, status: badge(displayStatus(state, session)) },
    rows, hiddenBefore: hidden, matches: all.filter(row => row.match).length, targetFound: target !== null && all.some(row => row.id === target),
    rail: rail(state, session),
  };
}

