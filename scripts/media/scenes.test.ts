import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { shots, webViews, budget } from './scenes.ts';
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
