import assert from 'node:assert/strict';
import fs, { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { EventLog, Health } from '@pi-console/contract';
import { SqliteEventLog } from '@pi-console/core';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';
import { SessionIngestion } from './session-ingestion.ts';

const header = (id: string) => JSON.stringify({ type: 'session', version: 3, id, cwd: '/fixture', timestamp: '2026-01-02T00:00:00Z' }) + '\n';
const message = JSON.stringify({
  type: 'message', id: 'appended', timestamp: '2026-01-02T00:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
}) + '\n';

function directory(t: TestContext): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-console-session-discovery-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function sessions(log: EventLog): Promise<string[]> {
  const result: string[] = [];
  for await (const event of log.readFrom(0)) if (event.type === 'SessionStarted') result.push(event.subject);
  return result.sort();
}

for (const kind of ['missing', 'non-directory']) for (const brokenFirst of [false, true]) {
  test(`a ${kind} session root ${brokenFirst ? 'before' : 'after'} a healthy root degrades health but recovers next poll`, async t => {
    const root = directory(t);
    const healthy = join(root, 'healthy');
    const broken = join(root, 'broken');
    mkdirSync(healthy);
    const file = join(healthy, 'healthy.jsonl');
    writeFileSync(file, header('healthy'));
    if (kind === 'non-directory') writeFileSync(broken, 'not a directory');
    const spec = await specDaemon([], { sessionRoots: brokenFirst ? [broken, healthy] : [healthy, broken] });
    t.after(() => spec.close());
    const health = async () => (await call(spec.daemon.port, '/api/v1/health', {
      headers: { Authorization: `Bearer ${spec.token}` },
    })).body as Health;
    await spec.daemon.ingestion.poll();
    assert.deepEqual(await sessions(spec.daemon.log), ['session:healthy']);
    const failed = await health();
    assert.equal(failed.status, 'degraded');
    assert.equal(failed.sources.find(source => source.source === 'session-jsonl')?.errors, 1);
    assert.equal(JSON.stringify(failed).includes(root), false);
    const before = spec.daemon.log.lastSeq();
    appendFileSync(file, message);
    await spec.daemon.ingestion.poll();
    assert.ok(spec.daemon.log.lastSeq() > before, 'the healthy root keeps ingesting during the outage');
    assert.equal((await health()).status, 'degraded');
    rmSync(broken, { force: true });
    mkdirSync(broken);
    writeFileSync(join(broken, 'recovered.jsonl'), header('recovered'));
    await spec.daemon.ingestion.poll();
    assert.deepEqual(await sessions(spec.daemon.log), ['session:healthy', 'session:recovered']);
    const recovered = await health();
    assert.equal(recovered.status, 'ok');
    assert.equal(recovered.sources.find(source => source.source === 'session-jsonl')?.errors, 0);
  });
}

for (const failure of ['EACCES', 'ENOENT', 'unexpected']) {
  test(`a subtree discovery failure (${failure}) is reported without losing healthy files, then retried`, async t => {
    const root = directory(t);
    const broken = join(root, 'broken');
    const sibling = join(root, 'sibling');
    mkdirSync(broken);
    mkdirSync(sibling);
    writeFileSync(join(root, 'healthy.jsonl'), header('healthy'));
    writeFileSync(join(sibling, 'sibling.jsonl'), header('sibling'));
    writeFileSync(join(broken, 'recovered.jsonl'), header('recovered'));
    const read = fs.readdirSync;
    const error = failure === 'unexpected' ? new Error('unexpected discovery failure') : Object.assign(new Error('unavailable subtree'), { code: failure });
    const blocked = t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof read>) => {
      if (String(args[0]) === broken) throw error;
      return Reflect.apply(read, fs, args);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const log = new SqliteEventLog(':memory:');
    t.after(() => log.close());
    const worker = new SessionIngestion(log, { roots: [root], backfillWindowDays: 14, pollMs: 60_000 });
    await worker.poll();
    assert.deepEqual(await sessions(log), ['session:healthy', 'session:sibling']);
    assert.equal(worker.status.errors, 1, 'unexpected failures also surface through source health');
    assert.equal(worker.backfillComplete, true);
    blocked.mock.restore();
    syncBuiltinESMExports();
    await worker.poll();
    assert.deepEqual(await sessions(log), ['session:healthy', 'session:recovered', 'session:sibling']);
    assert.equal(worker.status.errors, 0);
  });
}
