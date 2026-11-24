import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { URL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { startDemo, startTicker, launchUrl, openBrowser } from './demo.mjs';
import { demoData, demoTickLimit, demoTickMs } from './demo-data.mjs';
import { rebase } from './media/fixture.mjs';
import { generate } from '../packages/testkit/src/fixture/generate.ts';
import { createStore } from '../packages/testkit/src/mock-daemon/store.ts';
import { apiV1Schema as schema, validate } from '../packages/contract/src/index.ts';
import { loadToken } from '../packages/web/src/client/token.ts';

function grouping(sessions) {
  return Object.groupBy(sessions.map(({ id, repositoryId }) => ({ id, repositoryId })), session => session.repositoryId);
}

test('console serves the gallery fixture on loopback, requires its temporary token and cleans up', async () => {
  const demo = await startDemo();
  const url = `http://127.0.0.1:${demo.port}`;
  try {
    assert.equal(demo.address, '127.0.0.1');
    const link = new URL(launchUrl(demo));
    assert.equal(link.pathname, '/');
    assert.equal(link.search, '');
    const { token, cleanHash } = loadToken({ getItem: () => null, setItem() {} }, link.hash);
    assert.equal(token, readFileSync(demo.tokenFile, 'utf8').trim());
    assert.equal(cleanHash, '');
    const headers = { Authorization: `Bearer ${token}` };
    for (const path of ['/sessions', '/stream']) assert.equal((await globalThis.fetch(`${url}/api/v1${path}`)).status, 401);
    const sessions = await (await globalThis.fetch(`${url}/api/v1/sessions`, { headers })).json();
    validate(sessions, schema.$defs.sessions, schema);
    assert.equal(sessions.items.length, 30);
    assert.deepEqual(grouping(sessions.items), grouping(generate(192).fixture.sessions));
    const settings = await (await globalThis.fetch(`${url}/api/v1/settings`, { headers })).json();
    assert.deepEqual(settings.sources, [{ source: 'mock', enabled: true }]);
    const memory = await (await globalThis.fetch(`${url}/api/v1/memory-items`, { headers })).json();
    assert.ok(memory.items.length > 0);
    assert.ok(memory.items.every(item => Date.now() - Date.parse(item.at) < 86400000));
  } finally { await demo.close(); }
  assert.equal(existsSync(demo.directory), false);
  await assert.rejects(globalThis.fetch(`${url}/api/v1/health`));
});

test('seed preserves gallery repository grouping and identities without changing cwd', () => {
  const now = new Date('2030-04-03T12:00:00Z');
  const gallery = generate(192).fixture;
  const { fixture, memory } = demoData(now);
  assert.equal(fixture.sessions.length, 30);
  assert.equal(Object.keys(grouping(fixture.sessions)).length, 6);
  assert.deepEqual(grouping(fixture.sessions), grouping(gallery.sessions));
  fixture.sessions.forEach((session, index) => {
    const original = gallery.sessions[index];
    for (const key of ['name', 'cwd', 'laneId', 'branch', 'repositoryId', 'costUsd']) assert.equal(session[key], original[key]);
    assert.doesNotMatch(session.name, /^s\d+$/);
    assert.notEqual(session.laneId, 'unassigned');
    assert.ok(now.getTime() - Date.parse(session.updatedAt) < 86400000);
  });
  assert.ok(fixture.sessions.filter(session => session.costUsd !== null).length > 24);
  assert.ok(fixture.sessions.some(session => session.status === 'working'));
  assert.ok(fixture.sessions.some(session => session.status === 'failed'));
  assert.ok(memory.some(item => item.sessionId === 's2'));
  assert.equal(fixture.generatedAt, now.toISOString());
  assert.equal(Date.parse(gallery.generatedAt), Date.parse('2026-11-20T12:00:00Z'), 'media retains its pinned recording clock');
});

test('all seed clocks shift together, including transcript, request history and memory', () => {
  const first = demoData(new Date('2030-01-01T00:00:00Z'));
  const second = demoData(new Date('2030-01-01T01:00:00Z'));
  assert.deepEqual(rebase(first.fixture, 3600000), second.fixture);
  assert.deepEqual(rebase(first.memory, 3600000), second.memory);
  assert.equal(rebase(first.memoryHandoffAt, 3600000), second.memoryHandoffAt);
});

test('ticker publishes valid SSE updates and questions, then stops at a bounded event budget', () => {
  const now = new Date('2030-04-03T12:00:00Z');
  const { fixture, tick } = demoData(now);
  const store = createStore(0);
  Object.assign(store.fixture, fixture);
  const live = [];
  try {
    for (let index = 0; index < demoTickLimit; index++) {
      tick(new Date(now.getTime() + (index + 1) * demoTickMs)).forEach(({ type, payload }) => {
        const event = store.publish(type, payload);
        validate(event, schema.$defs.event, schema);
        live.push(event);
      });
    }
    assert.equal(live.filter(event => event.type === 'session.updated').length, demoTickLimit + 1);
    assert.ok(live.some(event => event.type === 'question.asked'));
    assert.deepEqual(tick(now), []);
    assert.equal(store.fixture.sessions.length, 30);
    const finished = live.find(event => event.type === 'session.updated' && event.payload.status === 'done');
    assert.ok(finished);
    assert.equal(store.fixture.sessions.find(session => session.id === finished.payload.id).status, 'done');
    assert.ok(store.fixture.questions.some(question => question.id.startsWith('demo-live-')));
    assert.ok(store.seq() < demoTickLimit + 20);
    assert.deepEqual(grouping(store.fixture.sessions), grouping(generate(192).fixture.sessions));
  } finally { store.close(); }
});

test('ticker scheduler publishes, stops at exhaustion and drains pending work on shutdown', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const batches = [];
  let ticks = 0;
  const stop = startTicker(events => { batches.push(events); }, () => ++ticks === 1 ? [{ type: 'sample' }] : [], 10);
  t.mock.timers.tick(10);
  await setImmediate();
  assert.equal(batches.length, 1);
  t.mock.timers.tick(10);
  await setImmediate();
  t.mock.timers.tick(1000);
  await stop();
  assert.equal(ticks, 2);
  assert.equal(batches.length, 1);
});

test('ticker shutdown cancels its timer before another publication', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let publications = 0;
  const stop = startTicker(() => { publications++; }, () => [{}], 10);
  t.mock.timers.tick(10);
  await stop();
  assert.equal(publications, 1);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(publications, 1);
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
