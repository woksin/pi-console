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
