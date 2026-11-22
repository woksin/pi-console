import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { createCompletedWorkRuntime } from './completed-work-runtime.ts';
import { Projector } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';

export const now = () => new Date('2026-11-20T09:00:00Z');
export const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

export async function workSpec() {
  const directory = mkdtempSync(join(tmpdir(), 'console-completed-'));
  const path = join(directory, 'console.db');
  const log = new SqliteEventLog(path);
  const store = new SqliteProjectionStore(path);
  const memory = new Projector(log, consoleProjections());
  const sql = new Projector(log, consoleProjections(), store, { work: createCompletedWorkRuntime(store) });
  const queries = (projector: Projector) => new ConsoleQueries(() => readModels(projector), now);
  await memory.start();
  await sql.start();
  return {
    path, log, store, memory, sql, expected: queries(memory), actual: queries(sql),
    async append(events: readonly NewEvent[]) {
      await log.append(events);
      for (let attempts = 0; attempts < 100 && (sql.position < log.lastSeq() || memory.position < log.lastSeq()); attempts++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(sql.position, log.lastSeq());
      assert.equal(memory.position, log.lastSeq());
    },
    close() { memory.stop(); sql.stop(); store.close(); log.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
