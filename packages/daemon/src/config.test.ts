import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig } from './config.ts';

const dataDir = (t: { after(fn: () => void): void }, config?: unknown): string => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-config-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  if (config !== undefined) writeFileSync(join(directory, 'config.json'), JSON.stringify(config));
  return directory;
};

test('defaults apply without a config file; v1 keeps 10,000 deltas for resume', t => {
  const directory = dataDir(t);
  const config = loadConfig(directory);
  assert.deepEqual(config, defaultConfig(directory));
  assert.equal(config.replayWindow, 10_000);
  assert.equal(config.webDist, undefined);
});

test('config.json values apply, relative paths resolve against the data directory, flags win', t => {
  const directory = dataDir(t, { port: 5000, webDist: 'web', sessionRoots: ['/abs/sessions'], backfillWindowDays: 3 });
  const config = loadConfig(directory, { port: 6000 });
  assert.equal(config.port, 6000);
  assert.equal(config.webDist, join(directory, 'web'));
  assert.deepEqual(config.sessionRoots, ['/abs/sessions']);
  assert.equal(config.backfillWindowDays, 3);
});

test('invalid config values are refused with the field name', t => {
  for (const [value, field] of [[{ port: 70000 }, /port/], [{ port: '1' }, /port/], [{ webDist: 1 }, /webDist/], [{ sessionRoots: 'x' }, /sessionRoots/], [{ backfillWindowDays: -1 }, /backfillWindowDays/], [[], /object/]] as const) {
    assert.throws(() => loadConfig(dataDir(t, value)), field);
  }
});

test('agentRoot derives the session root unless sessionRoots is set; sources merge over the defaults', t => {
  const directory = dataDir(t, { agentRoot: '/agent', orchRoot: '/orch', sources: { 'issue-work': false }, sourcePollMs: 500 });
  const config = loadConfig(directory);
  assert.deepEqual([config.agentRoot, config.orchRoot, config.sourcePollMs], ['/agent', '/orch', 500]);
  assert.deepEqual(config.sessionRoots, ['/agent/sessions']);
  assert.equal(config.sources['issue-work'], false);
  assert.equal(config.sources['phase-ledger'], true);
  assert.deepEqual(loadConfig(directory, { sessionRoots: ['/x'] }).sessionRoots, ['/x']);
  assert.equal(loadConfig(directory, { sources: { 'phase-ledger': false } }).sources['issue-work'], false);
});

test('config.json rejects unknown sources, non-boolean switches and a poll interval out of range', t => {
  for (const bad of [{ sources: { nope: true } }, { sources: { 'issue-work': 'no' } }, { sourcePollMs: 10 }, { agentRoot: 3 }]) {
    assert.throws(() => loadConfig(dataDir(t, bad)), /sources|sourcePollMs|agentRoot/);
  }
});
