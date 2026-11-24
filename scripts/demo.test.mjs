import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import { startDemo, launchUrl, openBrowser } from './demo.mjs';
import { demoData, demoTickLimit, demoTickMs } from './demo-data.mjs';
import { generate } from '../packages/testkit/src/fixture/generate.ts';
import { SqliteEventLog } from '../packages/core/src/event-log/sqlite-event-log.ts';
import { Projector } from '../packages/core/src/projector/projector.ts';
import { consoleProjections, readModels } from '../packages/core/src/projections/index.ts';
import { ConsoleQueries } from '../packages/core/src/queries/console-queries.ts';
import { loadToken } from '../packages/web/src/client/token.ts';

test('demo is authenticated, synthetic, ingestion-free and removes its private data on close', async () => {
  const demo = await startDemo();
  const url = `http://127.0.0.1:${demo.port}`;
  try {
    assert.equal(statSync(demo.directory).mode & 0o777, 0o700);
    assert.equal(statSync(demo.tokenFile).mode & 0o777, 0o600);
    assert.equal((await globalThis.fetch(`${url}/api/v1/sessions`)).status, 401);
    const link = new URL(launchUrl(demo));
    assert.equal(link.pathname, '/');
    assert.equal(link.search, '');
    const { token, cleanHash } = loadToken({ getItem: () => null, setItem() {} }, link.hash);
    assert.equal(token, readFileSync(demo.tokenFile, 'utf8').trim());
    assert.equal(cleanHash, '');
    const headers = { Authorization: `Bearer ${token}` };
    const get = async path => {
      const response = await globalThis.fetch(`${url}/api/v1/${path}`, { headers });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const sessions = await get('sessions');
    assert.equal(sessions.items.length, 30);
    assert.ok(sessions.items.every(session => session.cwd.startsWith('/synthetic/')));
    assert.ok((await get('requests')).items.length > 0);
    assert.ok((await get('questions')).items.length > 0);
    assert.ok((await get('messages')).items.length > 0);
    assert.ok((await get('jobs')).items.length > 0);
    assert.ok((await get('sessions/s2/transcript')).items.length > 0);
    const settings = await get('settings');
    assert.ok(settings.sources.every(source => !source.enabled));
    assert.equal((await get('health')).projection.skipped, 0);
  } finally { await demo.close(); }
  assert.equal(existsSync(demo.directory), false);
  await assert.rejects(globalThis.fetch(`${url}/api/v1/health`));
});

async function project(events, now, check) {
  const log = new SqliteEventLog(':memory:');
  try {
    await log.append(events); // Also validates every seed/ticker payload against the event contract.
    const projector = new Projector(log, consoleProjections());
    await projector.catchUp();
    const queries = new ConsoleQueries(() => readModels(projector), () => now);
    await check(queries);
  } finally { log.close(); }
}

test('seed preserves showcase labels, lanes, branches, costs and mixed statuses with recent ages', async () => {
  const now = new Date('2030-04-03T12:00:00Z');
  const { fixture } = generate(192);
  const { events } = demoData(now);
  await project(events, now, queries => {
    const sessions = queries.sessions();
    assert.equal(sessions.length, fixture.sessions.length);
    for (const session of sessions) {
      const original = fixture.sessions.find(item => item.id === session.id);
      assert.equal(session.name, original.name);
      assert.doesNotMatch(session.name, /^s\d+$/);
      assert.equal(session.laneId, `${original.laneId}-${original.repositoryId}`);
      assert.notEqual(session.laneId, 'unassigned');
      assert.equal(session.branch, original.branch);
      assert.equal(session.costUsd, original.costUsd);
      assert.ok(now.getTime() - Date.parse(session.updatedAt) < 86400000);
    }
    assert.ok(sessions.filter(session => session.costUsd !== null).length > sessions.length * 0.8);
    assert.ok(sessions.some(session => session.status === 'working'));
    assert.ok(sessions.some(session => session.status === 'failed'));
    assert.ok(queries.memoryItems().length > 0);
  });
  const times = events.map(event => Date.parse(event.occurredAt));
  assert.ok(Math.max(...times) <= now.getTime());
  assert.ok(now.getTime() - Math.max(...times) < 60000);
  assert.ok(now.getTime() - Math.min(...times) < 86400000);
});

test('all seed clocks move together, including burn samples, transcript entries and memory', async () => {
  const first = demoData(new Date('2030-01-01T00:00:00Z'));
  const second = demoData(new Date('2030-01-01T01:00:00Z'));
  assert.deepEqual(first.events.map(event => event.id), second.events.map(event => event.id));
  assert.deepEqual(second.events.map((event, index) => Date.parse(event.occurredAt) - Date.parse(first.events[index].occurredAt)), first.events.map(() => 3600000));
  const a = await first.transcripts.page('s2', 0, 1);
  const b = await second.transcripts.page('s2', 0, 1);
  assert.equal(Date.parse(b.items[0].at) - Date.parse(a.items[0].at), 3600000);
});

test('ticker emits valid activity, a finish and questions, then stops at its event budget', async () => {
  const now = new Date('2030-04-03T12:00:00Z');
  const { events, tick } = demoData(now);
  const live = Array.from({ length: demoTickLimit }, (_, index) => tick(new Date(now.getTime() + (index + 1) * demoTickMs))).flat();
  assert.equal(live.filter(event => event.type === 'SessionHeartbeat').length, demoTickLimit);
  assert.equal(live.filter(event => event.type === 'SessionEnded').length, 1);
  assert.ok(live.some(event => event.type === 'QuestionAsked'));
  assert.deepEqual(tick(now), []);
  await project([...events, ...live], now, queries => {
    assert.equal(queries.sessions().length, 30);
    assert.equal(queries.sessions().find(session => session.id === 's22').status, 'done');
    assert.ok(queries.questions().some(question => question.id.startsWith('demo-live-')));
  });
});

test('browser opening is optional and best effort on supported platforms', () => {
  const calls = [];
  const run = (...args) => { calls.push(args); return { status: 1 }; };
  const url = 'http://127.0.0.1:1234/#token=synthetic-demo-token';
  openBrowser(url, 'darwin', run);
  openBrowser(url, 'linux', run);
  openBrowser(url, 'win32', run);
  assert.deepEqual(calls.map(([command, args]) => [command, args]), [['open', [url]], ['xdg-open', [url]]]);
  assert.doesNotThrow(() => openBrowser(url, 'linux', () => { throw new Error('no opener'); }));
});

const { engines: { node: requiredNode } } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const version of ['18.0.0', '22.0.0', '25.0.0']) {
  test(`demo preflight rejects Node ${version} before loading any TypeScript`, () => {
    const entry = new URL('./demo.mjs', import.meta.url);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });
      process.argv[1] = ${JSON.stringify(entry.pathname)};
      await import(${JSON.stringify(entry.href)});
    `], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `pi-console requires Node.js ${requiredNode} (running ${version}); install Node.js ${requiredNode} and retry.\n`);
  });
}
