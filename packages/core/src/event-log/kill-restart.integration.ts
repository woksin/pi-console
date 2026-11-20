// Integration tier (`npm run gate:integration -- --scope core`): the ADR-0001 durability claim under 50 random kill
// points. Each round SIGKILLs a child that is appending batches with checkpoints, then checks that a fresh process
// sees no lost and no duplicated event and a checkpoint that matches the events exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crashChild, inspectCrashLog } from './crash-harness.ts';
import { seeded } from '../testing/scenario.ts';

const rounds = 50;
const total = 20_000;

test(`${rounds} random kill points lose nothing and duplicate nothing`, { timeout: 540_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-kill-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const path = join(directory, 'console.db');
  const random = seeded(Number(process.env.PI_CONSOLE_KILL_SEED ?? 50));
  let previous = 0;
  for (let round = 0; round < rounds; round++) {
    const killAfterBatches = 1 + Math.floor(random() * 40);
    const exit = await crashChild(path, total, killAfterBatches);
    const state = await inspectCrashLog(path);
    const context = `round ${round}, kill after ${killAfterBatches} batches, exit ${String(exit)}`;
    assert.ok(state.events >= previous, `${context}: committed events never disappear`);
    assert.equal(state.events, state.distinct, `${context}: no duplicate events`);
    assert.equal(state.events, state.checkpoint, `${context}: checkpoint and events commit together`);
    assert.equal(state.maxOffset, state.checkpoint, `${context}: no event beyond the checkpoint`);
    previous = state.events;
  }
  assert.equal(await crashChild(path, total), 0);
  assert.deepEqual(await inspectCrashLog(path), { events: total, distinct: total, checkpoint: total, maxOffset: total });
});
