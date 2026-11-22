import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDaemonPort, defaultDataDir, readDaemonConfigFile, readDaemonPort } from './daemon-config.ts';

function directory(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'pi-console-shared-config-'));
  t.after(() => { rmSync(path, { recursive: true, force: true }); });
  return path;
}

test('the shared default data directory is ~/.pi-console', () => {
  assert.equal(defaultDataDir(), join(homedir(), '.pi-console'));
});

test('a missing config file supplies no overrides and the default port', t => {
  const path = directory(t);
  assert.deepEqual(readDaemonConfigFile(path), {});
  assert.equal(readDaemonPort(path), defaultDaemonPort);
});

for (const port of [0, 5888, 65_535]) {
  test(`reads configured port ${String(port)} without daemon field validation`, t => {
    const path = directory(t);
    writeFileSync(join(path, 'config.json'), JSON.stringify({ port, sources: 'unused by clients' }));
    assert.equal(readDaemonPort(path), port);
  });
}

for (const config of ['{', 'null', '[]', '5']) {
  test(`malformed config ${config} throws for the daemon but falls back for clients`, t => {
    const path = directory(t);
    writeFileSync(join(path, 'config.json'), config);
    assert.throws(() => readDaemonConfigFile(path));
    assert.equal(readDaemonPort(path), defaultDaemonPort);
  });
}

for (const port of [undefined, null, -1, 65_536, 5.5, '5888', true]) {
  test(`missing or invalid port ${String(port)} falls back to the default`, t => {
    const path = directory(t);
    writeFileSync(join(path, 'config.json'), JSON.stringify({ port }));
    assert.equal(readDaemonPort(path), defaultDaemonPort);
  });
}

test('an unreadable config file falls back for clients', t => {
  const path = directory(t);
  mkdirSync(join(path, 'config.json'));
  assert.equal(readDaemonPort(path), defaultDaemonPort);
});
