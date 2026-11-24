import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { URL } from 'node:url';
import { shots, webViews, budget, flowIds, byId, fixedNow } from './scenes.ts';
import { readFileSync } from 'node:fs';
import { maxAdvanceMs, stepMs } from './web-page.ts';
import { needsYouCount, quiesce, memoryReceipt, showcaseHealth } from './showcase.ts';
import { memoryItems } from '../../packages/testkit/src/mock-daemon/memory.ts';
import { prepareShowcase, showcaseMemory } from './fixture.mjs';
import { generate } from '../../packages/testkit/src/fixture/generate.ts';
import './clock.test.mjs';

const ids = new Set(shots.map(shot => shot.id));
test('every registered shot has a unique id and output path', () => {
  assert.equal(ids.size, shots.length);
  assert.equal(new Set(shots.map(shot => shot.file)).size, shots.length);
});

test('every main web view and history/retry scene has dark and light captures', () => {
  for (const id of [...webViews.map(view => view.id), 'timeline-history', 'attention-retry']) {
    assert.ok(ids.has(`web-${id}`), id);
    assert.ok(ids.has(`web-${id}-light`), `${id} light`);
  }
});

test('the connect, first-run and live-state flows are registered as web captures', () => {
  for (const id of flowIds) assert.equal(byId(id).client, 'web', id);
  assert.deepEqual(flowIds.map(id => byId(id).kind), ['still', 'still', 'gif', 'gif']);
});

test('the Needs you headline parses to its count and calm text is not a count', () => {
  assert.equal(needsYouCount('19 things need you'), 19);
  assert.equal(needsYouCount('1 thing needs you'), 1);
  assert.equal(needsYouCount('All clear'), null);
});

test('gallery health reports one sequence everywhere', () => {
  const health = showcaseHealth(412, 1);
  assert.deepEqual([health.eventLog.lastSeq, health.projection.position, health.stream.seq], [412, 412, 412]);
  assert.ok(health.sources.every(source => source.availability === 'available'));
});

test('showcase questions use natural wording and actors from the visible lanes', () => {
  const { fixture } = generate();
  prepareShowcase(fixture, memoryItems().map(item => ({ ...item })));
  const question = fixture.questions[0];
  assert.match(question.text, /Which option should the coordinator use/);
  assert.ok(question.options.every(option => option.includes('expire the cache entries')));
  assert.doesNotMatch(JSON.stringify(fixture.questions), /synthetic|"L[1-3]"/);
  const lanes = new Set(fixture.sessions.map(session => session.laneId));
  for (const question of fixture.questions) {
    const history = question.history ?? [];
    for (const entry of history) assert.ok(lanes.has(entry.actor), entry.actor);
  }
});

test('a synthetic receipt never expires within the fixed capture clock', () => {
  const receipt = memoryReceipt('awaiting-ingestion', { requestId: 'r', itemId: 'i', action: 'confirm' });
  assert.ok(receipt.expiresAt > Date.parse('2026-11-20T12:00:00Z'));
  assert.equal(receipt.state, 'awaiting-ingestion');
});

test('quiesce resolves once the sequence stops moving and rejects when it never does', async () => {
  let seq = 0;
  const timer = setInterval(() => { if (seq < 5) seq++; }, 10);
  assert.equal(await quiesce({ seq: () => seq }, { stableMs: 80 }), 5);
  clearInterval(timer);
  let moving = 0;
  const busy = setInterval(() => { moving++; }, 5);
  await assert.rejects(quiesce({ seq: () => moving }, { stableMs: 80, timeoutMs: 300 }), /never settled/);
  clearInterval(busy);
});

test('the live flows never let the browser clock run on its own', () => {
  const page = readFileSync(new URL('./web-page.ts', import.meta.url), 'utf8');
  const flows = readFileSync(new URL('./web-flows.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /clock\.resume\(/);
  assert.doesNotMatch(flows, /'running'/);
  assert.match(flows, /clock: 'controlled'/);
  assert.match(page, /clock\.pauseAt\(new Date\(fixedNow\)\)/);
  assert.ok(stepMs > 0 && maxAdvanceMs % stepMs === 0, 'virtual time moves in whole steps up to a bound');
});

test('terminal-only detail scenes are registered within the gallery budget', () => {
  for (const id of ['question-expanded', 'memory-paging', 'memory-review', 'attention-retry', 'settings-scroll']) {
    assert.ok(ids.has(`tui-${id}`), id);
  }
  assert.ok(budget.totalKb <= 6144);
});

for (const fail of [false, true]) {
  test(`capture ${fail ? 'failure' : 'success'} removes intermediate frames at exit`, () => {
    const source = `
      import fs from 'node:fs';
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { chromium } from 'playwright-core';
      const rm = fs.rmSync, mkdir = fs.mkdirSync;
      let removals = 0;
      fs.rmSync = (path, ...args) => {
        if (path.endsWith('/.ai-work/media-work')) {
          removals++;
          if (removals === 2) console.log('intermediate frames removed');
        } else rm(path, ...args);
      };
      fs.mkdirSync = (path, ...args) => {
        if (!path.endsWith('/.ai-work/media-work')) return mkdir(path, ...args);
      };
      cp.spawnSync = () => ({ status: 0 });
      chromium.launch = async () => {
        if (${String(fail)}) throw new Error('synthetic capture failure');
        return { newContext: async () => ({ newPage: async () => ({}), close: async () => {} }), close: async () => {} };
      };
      syncBuiltinESMExports();
      process.argv = ['node', 'media', '--only', 'not-a-shot'];
      await import('./scripts/media/index.mjs');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, fail ? 1 : 0, result.stderr);
    assert.match(result.stdout, /intermediate frames removed/);
  });
}

test('showcase memory is realistic, recent and leads with the newest proposal while the withheld rejection stays last', () => {
  const source = memoryItems();
  const before = JSON.parse(JSON.stringify(source));
  const items = showcaseMemory(source, fixedNow);
  assert.deepEqual(source, before, 'the shared mock memory is not mutated');
  assert.ok(items.every(item => !item.text.startsWith('synthetic memory item')));
  assert.equal(new Set(items.map(item => item.text)).size, items.length, 'every item reads distinctly');
  const newestFirst = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  assert.deepEqual(items.map(item => item.id), newestFirst.map(item => item.id), 'returned order is newest first');
  assert.equal(items[0]?.status, 'proposed');
  const withheld = items.findIndex(item => item.withheld);
  assert.ok(withheld > 0, 'the withheld item is not first');
  assert.equal(items[withheld]?.status, 'rejected');
  const ages = items.map(item => Date.parse(fixedNow) - Date.parse(item.at));
  assert.ok(ages.every(age => age > 0 && age < 6 * 3600_000), 'ages are minutes to hours before the transcript');
});

test('showcase memory keeps ids, status, provenance and the wider-scope example', () => {
  const source = memoryItems();
  const items = showcaseMemory(source, fixedNow);
  for (const original of source) {
    const decorated = items.find(item => item.id === original.id);
    assert.ok(decorated, original.id);
    assert.deepEqual([decorated.status, decorated.statusBasis, decorated.kind, decorated.sourceType, decorated.withheld, decorated.command],
      [original.status, original.statusBasis, original.kind, original.sourceType, original.withheld, original.command]);
  }
  assert.ok(items.some(item => item.scope.kind === 'global'));
  assert.ok(items.filter(item => item.sessionId !== null).every(item => item.sessionId === 's2' && item.scope.key === 's2'), 'session items sit with the transcript');
});
