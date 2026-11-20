import type { Job } from '@pi-console/contract';
import { age, badge, clip, type Badge } from '../common/format.ts';
import { sessionLabel, type ConsoleState } from '../state/index.ts';

export type WorkFilter = 'all' | Job['kind'];

export interface WorkContext { filter?: WorkFilter }

export interface WorkRow { id: string; kind: Job['kind']; name: string; session: string; sessionId: string; badge: Badge; age: string; exit: string }

export interface WorkViewModel {
  filter: WorkFilter;
  tabs: { id: WorkFilter; label: string; count: number }[];
  rows: WorkRow[];
  empty: boolean;
}

const tabs: { id: WorkFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'job', label: 'Jobs' }, { id: 'phase', label: 'Phases' }, { id: 'ci', label: 'CI' }];

export function buildWork(state: ConsoleState, context: WorkContext = {}): WorkViewModel {
  const filter = context.filter ?? 'all';
  const visible = state.jobs.filter(job => filter === 'all' || job.kind === filter);
  const rank = (job: Job) => ({ failed: 0, running: 1, queued: 2, done: 3 })[job.status];
  return {
    filter,
    tabs: tabs.map(tab => ({ ...tab, count: state.jobs.filter(job => tab.id === 'all' || job.kind === tab.id).length })),
    rows: visible.toSorted((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).map(job => ({
      id: job.id, kind: job.kind, name: clip(job.name, 80), session: sessionLabel(state, job.sessionId), sessionId: job.sessionId,
      badge: badge(job.status), age: age(state.liveAt, job.startedAt), exit: job.exitCode === null ? '' : `exit ${String(job.exitCode)}`,
    })),
    empty: state.jobs.length === 0,
  };
}
