import type { Job } from '@pi-console/contract';
import type { WorkState } from '../projections/work.ts';
import { terminalWork, type SqliteWorkRows, type WorkSelection } from '../projector/sqlite-work-rows.ts';
import { toJob } from './entities.ts';
import { decodeCursor, pageOf, sortedEntries, windowOf, type Entry, type Page, type PageParams } from './paging.ts';

export interface WorkPageParams extends PageParams { sessionId?: string }
export interface WorkWindow { items: Job[]; total: number; bounded: boolean }

/** Read-only seam shared by HTTP queries and independently constructed stream queries. */
export interface WorkQuerySource {
  byId(id: string): Job | undefined;
  all(sessionId?: string): Job[];
  page(params: WorkPageParams): Page<Job>;
  window(recent: number): WorkWindow;
}

const entries = (jobs: Job[]): Entry<Job>[] => jobs.map(job => ({
  key: job.startedAt, id: job.id, active: job.status === 'running', build: () => job,
}));

/** Resident rows shadow disk, including pre-commit changes to owner, sort key and status. */
export function sqlWorkQueries(rows: SqliteWorkRows, state: () => WorkState, readable: () => boolean): WorkQuerySource {
  const resident = () => Object.values(state().jobs);
  const selection = (sessionId?: string): WorkSelection => ({
    sessionId, exclude: resident().filter(terminalWork).map(job => job.id),
  });
  const live = (sessionId?: string) => resident().map(toJob).filter(job => sessionId === undefined || job.sessionId === sessionId);
  const persisted = (query: WorkSelection) => readable() ? rows.select(query).map(toJob) : [];
  const total = (query: WorkSelection, active: Job[]) => (readable() ? rows.count(query) : 0) + active.length;
  return {
    byId(id) {
      const jobs = state().jobs;
      const row = Object.hasOwn(jobs, id) ? jobs[id] : readable() ? rows.get(id) : undefined;
      return row ? toJob(row) : undefined;
    },
    all(sessionId) {
      return sortedEntries(entries([...persisted(selection(sessionId)), ...live(sessionId)])).map(entry => entry.build());
    },
    page(params) {
      const query = selection(params.sessionId);
      const after = params.after === undefined ? undefined : decodeCursor('jobs', params.after);
      const active = live(params.sessionId);
      const candidates = persisted({ ...query, after, order: params.order, limit: params.limit + 1 });
      return { ...pageOf('jobs', entries([...candidates, ...active]), params), total: total(query, active) };
    },
    window(recent) {
      const query = selection();
      const active = live();
      const candidates = recent > 0 ? persisted({ ...query, order: 'desc', limit: recent }) : [];
      const window = windowOf(entries([...candidates, ...active]), recent);
      const count = total(query, active);
      return { ...window, total: count, bounded: window.items.length < count };
    },
  };
}
