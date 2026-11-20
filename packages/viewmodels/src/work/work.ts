import type { Job, Session } from '@pi-console/contract';
import { age, sanitize } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export interface WorkRow { id: string; sessionId: string; session: string; kind: Job['kind']; name: string; status: StatusCell; exit: string; age: string }
export interface WorkViewModel { rows: WorkRow[]; running: number; failed: number }

const rank: Record<Job['status'], number> = { failed: 0, running: 1, queued: 2, done: 3 };

/** Jobs, phases and CI runs across the fleet: failures first, then running, queued, done. */
export function workViewModel(input: { jobs: readonly Job[]; sessions: readonly Session[]; now: number }): WorkViewModel {
  const names = new Map(input.sessions.map(session => [session.id, session.name]));
  const rows = [...input.jobs].sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(b.startedAt) - Date.parse(a.startedAt)).map(job => ({
    id: job.id, sessionId: job.sessionId, session: names.get(job.sessionId) ?? job.sessionId, kind: job.kind, name: sanitize(job.name),
    status: statusCell(job.status), exit: job.exitCode === null ? '' : `exit ${String(job.exitCode)}`, age: age(job.startedAt, input.now),
  }));
  return { rows, running: input.jobs.filter(job => job.status === 'running').length, failed: input.jobs.filter(job => job.status === 'failed').length };
}
