import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventEnvelope, NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { scenario, seeded } from '../testing/scenario.ts';
import { canonicalJson } from './canonical.ts';
import { Projector } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';
import type { Projection } from './projection.ts';

const directory = mkdtempSync(join(tmpdir(), 'pi-console-projector-'));
let files = 0;
const freshPath = () => join(directory, `db-${++files}.db`);
const events = scenario({ count: 3000, jitterSeconds: 120, rawRequests: true });
const settle = () => new Promise(resolve => setImmediate(resolve));

const serialise = (projector: Projector) => canonicalJson({ models: readModels(projector), skipped: projector.skipped });

async function replayFromEmpty(input: readonly NewEvent[]): Promise<string> {
  const log = new SqliteEventLog(freshPath());
  await log.append(input);
  const projector = new Projector(log, consoleProjections());
  await projector.catchUp();
  log.close();
  return serialise(projector);
}

/** Random batch sizes, so incremental runs cut the stream at different places. */
function batches(input: readonly NewEvent[], seed: number): NewEvent[][] {
  const random = seeded(seed);
  const result: NewEvent[][] = [];
  for (let start = 0; start < input.length;) {
    const size = 1 + Math.floor(random() * 40);
    result.push(input.slice(start, start + size));
    start += size;
  }
  return result;
}

test('replay from empty equals incremental live projection, byte for byte', async () => {
  const expected = await replayFromEmpty(events);
  const log = new SqliteEventLog(freshPath());
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  for (const batch of batches(events, 3)) await log.append(batch);
  await settle();
  projector.stop();
  log.close();
  assert.equal(serialise(projector), expected);
});

test('restarting from stored snapshots and continuing equals a replay from empty', async () => {
  const expected = await replayFromEmpty(events);
  const path = freshPath();
  const log = new SqliteEventLog(path);
  const parts = batches(events, 11);
  const half = Math.floor(parts.length / 2);
  for (const batch of parts.slice(0, half)) await log.append(batch);
  const firstStore = new SqliteProjectionStore(path);
  await new Projector(log, consoleProjections(), firstStore).catchUp();
  firstStore.close();
  for (const batch of parts.slice(half)) await log.append(batch);
  const secondStore = new SqliteProjectionStore(path);
  const resumed = new Projector(log, consoleProjections(), secondStore);
  assert.ok(resumed.position > 0, 'resumed from a snapshot, not from empty');
  await resumed.catchUp();
  secondStore.close();
  log.close();
  assert.equal(serialise(resumed), expected);
});

test('unknown types, future versions and invalid payloads are skipped and counted once', async () => {
  const log = new SqliteEventLog(freshPath());
  await log.append(events);
  const projector = new Projector(log, consoleProjections());
  await projector.catchUp();
  await projector.catchUp();
  log.close();
  const expected = (filter: (n: number) => boolean) => Array.from({ length: events.length }, (_, n) => n).filter(filter).length;
  assert.deepEqual(projector.skipped.counts, {
    'unknown-version': expected(n => n % 97 === 13),
    'unknown-type': expected(n => n % 97 !== 13 && n % 89 === 5),
    'invalid-payload': expected(n => n % 97 !== 13 && n % 89 !== 5 && n % 83 === 3),
  });
});

test('a projection version bump rebuilds only that projection from empty', async () => {
  const path = freshPath();
  const log = new SqliteEventLog(path);
  await log.append(events.slice(0, 50));
  const counter = (version: number): Projection<{ count: number }> => ({
    name: 'counter', version, initial: () => ({ count: 0 }), apply: (state: { count: number }) => ({ count: state.count + 1 }),
  });
  const store = new SqliteProjectionStore(path);
  await new Projector(log, [counter(1)], store).catchUp();
  await log.append(events.slice(50, 80));
  const rebuilt = new Projector(log, [counter(2)], store);
  assert.equal((rebuilt.state('counter') as { count: number }).count, 0);
  await rebuilt.catchUp();
  store.close();
  log.close();
  assert.ok((rebuilt.state('counter') as { count: number }).count > 50);
});

test('late arrivals are ordered by occurredAt, not by arrival', async () => {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const build = async (input: readonly NewEvent[]) => {
    const log = new SqliteEventLog(freshPath());
    await log.append(input);
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    log.close();
    const models = readModels(projector);
    const order = <T>(items: Record<string, T>, key: (item: T) => unknown) => Object.keys(items).sort().map(id => key(items[id]));
    return canonicalJson({
      samples: order(models.burn.sessions, burn => burn.samples.map(sample => sample.at)),
      resets: order(models.sessions.sessions, session => session.resets.map(reset => reset.at)),
      latest: order(models.sessions.sessions, session => [session.startedAt, session.updatedAt, session.model]),
      lanes: order(models.lanes.lanes, lane => [lane.status, lane.waitingOn]),
      receipts: order(models.messages.messages, message => message.status),
    });
  };
  assert.equal(await build(events), await build(ordered));
});

test('live listeners see every event once, after it is folded in', async () => {
  const log = new SqliteEventLog(freshPath());
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  const seen: EventEnvelope[] = [];
  projector.onApplied(event => { seen.push(event); assert.equal(projector.position, event.seq); });
  await log.append(events.slice(0, 20));
  await log.append(events.slice(0, 30));
  await settle();
  projector.stop();
  log.close();
  assert.deepEqual(seen.map(event => event.seq), Array.from({ length: 30 }, (_, i) => i + 1));
});
