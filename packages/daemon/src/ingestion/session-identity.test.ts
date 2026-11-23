import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneMapper, laneMapperVersion, sessionTailer, type Mapper } from '@pi-console/adapters';
import { ConsoleQueries, consoleProjections, Projector, readModels, SqliteEventLog } from '@pi-console/core';
import { SourceIngestion } from './source-ingestion.ts';

const oldLaneMapper: Mapper = record => laneMapper(record).map(fact => ({ ...fact, payload: { laneId: fact.payload.laneId, name: fact.payload.name, repositoryId: fact.payload.repositoryId } }));

test('unchanged legacy lane checkpoints refresh once; restart and copied assistant entries never double count', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-identity-'));
  const log = new SqliteEventLog(join(root, 'events.db'));
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  const queries = new ConsoleQueries(() => readModels(projector));
  t.after(() => { projector.stop(); log.close(); rmSync(root, { recursive: true, force: true }); });
  const file = join(root, 'session.jsonl');
  const transcript = [
    { type: 'session', version: 3, id: 's', cwd: '/work/repo', timestamp: '2026-07-01T09:00:00Z' },
    { type: 'message', id: 'answer', timestamp: '2026-07-01T09:00:01Z', message: { role: 'assistant', stopReason: 'toolUse', usage: { cost: { total: 1.25 } }, content: [] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(file, transcript);
  const tailer = sessionTailer(log, file);
  await tailer.poll([file]);
  await tailer.close();
  assert.equal(queries.sessionById('s')!.costUsd, 1.25);
  assert.equal(queries.sessionById('s')!.laneId, 'unassigned');
  const laneRoot = join(root, 'lanes');
  mkdirSync(laneRoot);
  writeFileSync(join(laneRoot, 'lanes.json'), JSON.stringify({ version: 1, lanes: [{ id: 'L1', cwd: '/work/repo', branch: 'feature' }] }));
  const worker = (mapper: Mapper, mapperVersion?: string) => new SourceIngestion(log, { id: 'lane-messages', backfillWindowDays: 1, feeds: [{ directories: [laneRoot], name: /^lanes\.json$/, extension: '.json', recursive: false, kind: 'snapshot', mapper, mapperVersion }] });
  await worker(oldLaneMapper).poll();
  assert.equal(queries.sessionById('s')!.laneId, 'unassigned');
  const refreshed = worker(laneMapper, laneMapperVersion);
  await refreshed.poll();
  assert.equal(queries.sessionById('s')!.laneId, 'L1');
  assert.equal(queries.sessionById('s')!.branch, 'feature');
  const count = (await Array.fromAsync(log.readFrom(0))).length;
  await worker(laneMapper, laneMapperVersion).poll();
  assert.equal((await Array.fromAsync(log.readFrom(0))).length, count);
  const copy = join(root, 'copy.jsonl');
  writeFileSync(copy, transcript);
  const replay = sessionTailer(log, copy, { replay: true });
  await replay.poll([file, copy]);
  await replay.close();
  assert.equal(queries.sessionById('s')!.costUsd, 1.25);
  assert.equal((await Array.fromAsync(log.readFrom(0))).filter(event => event.type === 'SessionCostObserved').length, 1);
});
