import type { Question, Session } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export const questionSorts = ['priority', 'updated', 'activity'] as const;
export type QuestionSort = (typeof questionSorts)[number];
export const questionSortLabels: Record<QuestionSort, string> = { priority: 'Priority', updated: 'Last updated', activity: 'Last activity' };

/** Inactivity thresholds both clients offer, in days; the first listed default is `defaultStaleDays`. */
export const staleDayPresets = [1, 7, 14, 30] as const;
export const defaultStaleDays = 7;
const dayMs = 86_400_000;

/** One recorded history entry, newest first, safe to print: text and labels are sanitized. */
export interface QuestionHistoryRow {
  key: string; operation: string; at: string; age: string; actor: string; excerpt: string | null; withheld: boolean;
  /** The note was cut at the source bound: `excerpt` then ends with an ellipsis and "(shortened)". */
  shortened: boolean;
}
export interface QuestionRow {
  id: string; sessionId: string; session: string; kind: Question['kind']; urgent: boolean; blocking: boolean; status: StatusCell;
  text: string; options: string[]; age: string;
  /** Stored revision time age; `–` when the source never supplied it. */
  updated: string; updatedAt: string | null;
  /** Newest recorded history entry, else the revision time, else creation: when something last happened. */
  lastActivityAt: string; lastActivity: string;
  /** Text-labelled inactivity warning on open questions, never colour alone; `null` when active or not open. */
  stale: string | null;
  /** `null` means the source supplied no history (old events); an empty list means it supplied none recorded. */
  history: QuestionHistoryRow[] | null;
  links: string[];
}
export interface QuestionsViewModel { rows: QuestionRow[]; open: number; blocking: number }
export interface QuestionsInput {
  questions: readonly Question[]; sessions: readonly Session[]; now: number;
  sort?: QuestionSort; staleDays?: number;
}

const rank = (question: Question) => (question.status === 'open' ? 0 : 1) * 4 + (question.blocking ? 0 : 2) + (question.urgency === 'high' ? 0 : 1);
const time = (iso: string | undefined): number => { const ms = Date.parse(iso ?? ''); return Number.isNaN(ms) ? 0 : ms; };

const verbs: Record<string, string> = {
  created: 'created', edited: 'edited', comment: 'commented', answered: 'answered', decided: 'decided', deferred: 'deferred', reopened: 'reopened',
  withdrawn: 'withdrawn', superseded: 'superseded', closed: 'closed', linked: 'linked', claimed: 'claimed', unclaimed: 'unclaimed', declined: 'declined',
};
const verb = (operation: string): string => verbs[operation] ?? (sanitize(operation) || 'changed');

const noteText = (entry: HistoryEntry): string | null => (entry.excerpt === undefined ? null : `${sanitize(entry.excerpt)}${entry.truncated ? '… (shortened)' : ''}`);

function historyRows(question: Question, now: number): QuestionHistoryRow[] | null {
  if (!question.history) return null;
  return question.history.map(entry => ({
    key: String(entry.sequence), operation: verb(entry.operation), at: entry.at, age: age(entry.at, now), actor: sanitize(entry.actor ?? '') || 'unknown',
    excerpt: noteText(entry), withheld: entry.withheld ?? false, shortened: entry.truncated === true,
  }));
}

type HistoryEntry = NonNullable<Question['history']>[number];
interface Activity { at: string; entry: HistoryEntry | undefined }

const newer = (next: HistoryEntry, latest: HistoryEntry | undefined): boolean =>
  !latest || time(next.at) > time(latest.at) || (time(next.at) === time(latest.at) && next.sequence > latest.sequence);

function activityOf(question: Question): Activity {
  const entry = question.history?.reduce<HistoryEntry | undefined>((latest, next) => (newer(next, latest) ? next : latest), undefined);
  return { at: entry?.at ?? question.updatedAt ?? question.createdAt, entry };
}

/** The activity phrase, e.g. `commented by L0, 2h ago`; without recorded history it names the stored update. */
function activityText({ entry, at }: Activity, now: number): string {
  if (!entry) return `${age(at, now)} ago`;
  const actor = sanitize(entry.actor ?? '');
  return `${verb(entry.operation)}${actor ? ` by ${actor}` : ''}, ${age(entry.at, now)} ago`;
}

/** Open and inactive for the whole threshold; timestamps in the future count as now, so they never warn. */
function staleLabel(question: Question, at: string, now: number, days: number): string | null {
  if (question.status !== 'open') return null;
  const idle = now - Math.min(time(at), now);
  return idle >= days * dayMs ? `Stale · no activity for ${age(at, now)}` : null;
}

type Compare = (a: Question, b: Question) => number;
const byId: Compare = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const updatedAt = (question: Question): number => time(question.updatedAt ?? question.createdAt);

const sorters: Record<QuestionSort, (activity: ReadonlyMap<string, string>) => Compare> = {
  updated: () => (a, b) => updatedAt(b) - updatedAt(a) || byId(a, b),
  activity: activity => (a, b) => time(activity.get(b.id)) - time(activity.get(a.id)) || byId(a, b),
  priority: () => (a, b) => rank(a) - rank(b) || time(a.createdAt) - time(b.createdAt) || byId(a, b),
};

/** Read-only queue: by default blocking and high urgency first and answered or closed sunk; or newest update or activity first. */
export function questionsViewModel(input: QuestionsInput): QuestionsViewModel {
  const names = new Map(input.sessions.map(session => [session.id, session.name]));
  const days = input.staleDays ?? defaultStaleDays;
  const activity = new Map(input.questions.map(question => [question.id, activityOf(question)]));
  const lastAt = new Map([...activity].map(([id, found]) => [id, found.at]));
  const rows = [...input.questions].sort(sorters[input.sort ?? 'priority'](lastAt)).map((question): QuestionRow => {
    const last = activity.get(question.id) ?? activityOf(question);
    return {
      id: question.id, sessionId: question.sessionId, session: names.get(question.sessionId) ?? question.sessionId, kind: question.kind,
      urgent: question.urgency === 'high', blocking: question.blocking, status: statusCell(question.status === 'open' ? (question.blocking ? 'needs-you' : 'open') : 'done'),
      text: sanitize(question.text), options: question.options.map(sanitize), age: age(question.createdAt, input.now),
      updated: question.updatedAt === undefined ? '–' : age(question.updatedAt, input.now), updatedAt: question.updatedAt ?? null,
      lastActivityAt: last.at, lastActivity: activityText(last, input.now), stale: staleLabel(question, last.at, input.now, days),
      history: historyRows(question, input.now), links: (question.links ?? []).map(sanitize),
    };
  });
  const open = input.questions.filter(question => question.status === 'open');
  return { rows, open: open.length, blocking: open.filter(question => question.blocking).length };
}

/** The `/` filter: case-insensitive substring over the question text and session name (shared by the TUI and web). */
export const filterQuestionRows = <T extends Pick<QuestionRow, 'text' | 'session'>>(rows: readonly T[], filter: string): T[] =>
  rows.filter(row => !filter || `${row.text} ${row.session}`.toLowerCase().includes(filter.toLowerCase()));
