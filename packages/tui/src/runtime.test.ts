import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('a renderer launch failure rejects run and stops the connected runtime', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    const failure = new Error('synthetic renderer failure');
    let stopped = 0, disposed = 0, connected = 0;
    mock.module('./packages/tui/src/view/renderer.ts', { namedExports: { launch: async () => { throw failure; } } });
    mock.module('./packages/tui/src/app.ts', { namedExports: { App: () => null } });
    mock.module('./packages/tui/src/api/client.ts', { namedExports: { DaemonClient: class {
      stream() { connected++; return Promise.resolve(); }
      stop() { stopped++; }
    } } });
    mock.module('./packages/tui/src/store/store.ts', { namedExports: { Store: class {
      dispose() { disposed++; }
    } } });
    const { run } = await import('./packages/tui/src/runtime.ts');
    await assert.rejects(run({ env: { PI_CONSOLE_TOKEN: 'synthetic-token' } }), error => error === failure);
    assert.equal(connected, 1);
    assert.equal(stopped, 1);
    assert.equal(disposed, 1);
  `;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', source], {
    cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});
