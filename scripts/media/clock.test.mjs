import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { questionsViewModel } from '@pi-console/viewmodels';
import { clockNow } from '../../packages/web/src/app/hooks.ts';
import { applyEvent } from '../../packages/web/src/state/reduce.ts';
import { emptyState } from '../../packages/web/src/state/state.ts';
import { fixedNow } from './scenes.ts';
import { startFrozenRig } from './web.ts';
import { startDemo } from '../demo.mjs';
import { demoTickMs } from '../demo-data.mjs';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';

test('VHS demo seed and live ticks use the same fixed clock as the client', async t => {
  const now = new Date(fixedNow);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const demo = await startDemo(undefined, () => now);
  try {
    const token = readFileSync(demo.tokenFile, 'utf8').trim();
    const sessions = async () => (await (await globalThis.fetch(`http://127.0.0.1:${demo.port}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json()).items;
    const before = await sessions();
    assert.ok(before.every(session => Date.parse(session.updatedAt) <= now.getTime()));
    assert.ok(before.every(session => now.getTime() - Date.parse(session.updatedAt) < 86400000));
    t.mock.timers.tick(demoTickMs);
    await setImmediate();
    const after = await sessions();
    assert.equal(after.length, before.length);
    assert.ok(after.some(session => session.updatedAt === now.toISOString()));
  } finally { await demo.close(); }
});

// Exercise the capture fixture without launching a browser or producing media.
test('web and TUI captures display the same ages for the expanded question', async t => {
  t.mock.method(chromium, 'launch', async () => ({ close: async () => {} }));
  const rig = await startFrozenRig();
  try {
    const wall = Date.parse(fixedNow);
    const state = applyEvent(emptyState(), {
      seq: rig.daemon.store.seq(), type: 'snapshot', occurredAt: fixedNow, payload: rig.daemon.store.snapshot(),
    });
    // The web store anchors receipt at the fixed browser wall time; the TUI parses PI_CONSOLE_NOW directly.
    const webNow = clockNow({ ...state, liveAtReceivedAt: wall }, wall);
    const input = { questions: state.questions, sessions: state.sessions };
    const web = questionsViewModel({ ...input, now: webNow }).rows.find(question => question.id === 'q1');
    const tui = questionsViewModel({ ...input, now: wall }).rows.find(question => question.id === 'q1');
    assert.ok(web);
    assert.ok(tui);
    assert.equal(web.age, tui.age);
    assert.equal(web.updated, tui.updated);
    assert.equal(web.age, '3h');
    assert.equal(web.updated, '2h');
    assert.equal(webNow, wall);
  } finally { await rig.close(); }
});
