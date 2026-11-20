import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { requestsProjection } from '../projections/requests.ts';
import { canonicalJson } from '../projector/canonical.ts';
import { Projector } from '../projector/projector.ts';
import { SqliteProjectionStore } from '../projector/sqlite-projection-store.ts';
import { scenario } from '../testing/scenario.ts';
import { requestDerivation } from './derivation.ts';

test('a snapshot of the previous requests projection is rebuilt, not reused: upgrading equals a replay from empty', async () => {
  assert.notEqual(requestDerivation.version, requestsProjection.version, 'the derivation changed the state shape');
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-requests-upgrade-'));
  const events = scenario({ count: 600, jitterSeconds: 120, rawRequests: true });
  const path = join(directory, 'upgrade.db');
  const log = new SqliteEventLog(path);
  await log.append(events.slice(0, 300));
  const store = new SqliteProjectionStore(path);
  await new Projector(log, consoleProjections(requestsProjection), store).catchUp();
  await log.append(events.slice(300));
  const upgraded = new Projector(log, consoleProjections(), store);
  await upgraded.catchUp();
  store.close();
  log.close();

  const freshLog = new SqliteEventLog(join(directory, 'fresh.db'));
  await freshLog.append(events);
  const fresh = new Projector(freshLog, consoleProjections());
  await fresh.catchUp();
  freshLog.close();
  assert.equal(canonicalJson(readModels(upgraded).requests), canonicalJson(readModels(fresh).requests));
});
