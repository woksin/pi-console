import type { EventEnvelope } from '@pi-console/contract';
import type { WorkState } from '../projections/work.ts';
import { sqlWorkQueries } from '../queries/work-queries.ts';
import type { ProjectionRuntime } from './projection.ts';
import type { SqliteProjectionStore } from './sqlite-projection-store.ts';
import { terminalWork } from './sqlite-work-rows.ts';

/** Target only handlers which actually read/update a work job. Unknown events cannot hydrate history. */
function affectedJob(event: EventEnvelope): string | undefined {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'JobStarted' || event.type === 'JobFinished') return payload.jobId as string;
  if (['PhaseQueued', 'PhaseStarted', 'PhaseFinished'].includes(event.type)) return `phase:${payload.phaseId as string}`;
  return undefined;
}

/** Storage and eviction are lifecycle work, never reducer work. */
export function createCompletedWorkRuntime(store: SqliteProjectionStore): ProjectionRuntime {
  const rows = store.workRows();
  let state: WorkState;
  let readable = false;
  return {
    restore: projection => rows.restore(projection.version),
    bind(value, restored) { state = value as WorkState; readable = restored; },
    beforeApply(event) {
      const id = affectedJob(event);
      if (id === undefined || !readable) return;
      if (Object.hasOwn(state.jobs, id)) return;
      const row = rows.get(id);
      if (row) state.jobs[id] = row;
    },
    afterCommit(dirty) {
      readable = true;
      for (const id of dirty.get('jobs') ?? []) {
        if (Object.hasOwn(state.jobs, id) && terminalWork(state.jobs[id])) delete state.jobs[id];
      }
    },
    querySource: sqlWorkQueries(rows, () => state, () => readable),
  };
}
