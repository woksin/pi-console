import type { Job, Session } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';
import { sessionLabels } from '../format/session-labels.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export interface WorkRow { id: string; sessionId: string; session: string; kind: Job['kind']; name: string; status: StatusCell; exit: string; age: string }
export interface WorkViewModel { rows: WorkRow[]; running: number; failed: number }

const rank: Record<Job['status'], number> = { failed: 0, running: 1, queued: 2, done: 3 };

/** A job placed in Work order with its clock-free presentation; the age is formatted later by {@link workRowAt}. */
export type WorkEntry = Omit<WorkRow, 'age'> & { startedAt: string };
/** Clock-free Work layout: failures first, then running, queued, done. Rebuild only when jobs or sessions change. */
export interface WorkStructure { entries: readonly WorkEntry[]; running: number; failed: number }

export function workStructure(input: { jobs: readonly Job[]; sessions: readonly Session[] }): WorkStructure {
  const names = new Map(input.sessions.map(session => [session.id, sessionLabels(session).title]));
  const entries = [...input.jobs].sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(b.startedAt) - Date.parse(a.startedAt)).map((job): WorkEntry => ({
    id: job.id, sessionId: job.sessionId, session: names.get(job.sessionId) ?? job.sessionId, kind: job.kind, name: sanitize(job.name),
    status: statusCell(job.status), exit: job.exitCode === null ? '' : `exit ${String(job.exitCode)}`, startedAt: job.startedAt,
  }));
  return { entries, running: input.jobs.filter(job => job.status === 'running').length, failed: input.jobs.filter(job => job.status === 'failed').length };
}

/** Formats one structural row for `now`. */
export const workRowAt = (entry: WorkEntry, now: number): WorkRow => ({
  id: entry.id, sessionId: entry.sessionId, session: entry.session, kind: entry.kind, name: entry.name,
  status: entry.status, exit: entry.exit, age: age(entry.startedAt, now),
});

/** Compatibility wrapper: every row formatted for `input.now`. Prefer {@link workStructure} plus {@link workRowAt} for large lists. */
export function workViewModel(input: { jobs: readonly Job[]; sessions: readonly Session[]; now: number }): WorkViewModel {
  const structure = workStructure(input);
  return { rows: structure.entries.map(entry => workRowAt(entry, input.now)), running: structure.running, failed: structure.failed };
}

/** The `/` filter: trimmed, case-insensitive substring over the job's identity, session, kind, name, status and exit (shared by the TUI and web). */
export const filterWorkRows = <T extends Pick<WorkRow, 'id' | 'sessionId' | 'session' | 'kind' | 'name' | 'status' | 'exit'>>(rows: readonly T[], filter: string): T[] => {
  const query = filter.trim().toLowerCase();
  return rows.filter(row => [row.id, row.sessionId, row.session, row.kind, row.name, row.status.label, row.exit].join(' ').toLowerCase().includes(query));
};
