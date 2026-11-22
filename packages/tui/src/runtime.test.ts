import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('attention fetch failures are recorded and retry reuses the runtime load', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    let pending = Promise.withResolvers(), calls = 0;
    mock.module('./packages/tui/src/view/renderer.ts', { namedExports: { launch: async () => {} } });
    mock.module('./packages/tui/src/app.ts', { namedExports: { App: () => null } });
    mock.module('./packages/tui/src/api/client.ts', { namedExports: { DaemonClient: class {
      stream() { return Promise.resolve(); }
      needsYou() { calls++; return pending.promise; }
      stop() {}
    } } });
    const { connect } = await import('./packages/tui/src/runtime.ts');
    const runtime = connect({ baseUrl: 'http://127.0.0.1', token: 'test', tokenSource: 'test' });
    const flush = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
    try {
      runtime.retryNeedsYou();
      assert.equal(runtime.store.getSnapshot().needsYouLoaded, false);
      assert.equal(runtime.store.getSnapshot().needsYouError, false);
      pending.reject(new Error('offline'));
      await flush();
      assert.equal(runtime.store.getSnapshot().needsYouError, true);
      mock.timers.tick(2000);
      pending = Promise.withResolvers();
      runtime.retryNeedsYou();
      assert.equal(calls, 2);
      assert.equal(runtime.store.getSnapshot().needsYouError, false);
      assert.equal(runtime.store.getSnapshot().needsYouLoaded, false);
      pending.resolve([]);
      await flush();
      assert.equal(runtime.store.getSnapshot().needsYouLoaded, true);
      mock.timers.tick(2000);
      pending = Promise.withResolvers();
      runtime.retryNeedsYou();
      pending.reject(new Error('offline again'));
      await flush();
      assert.equal(runtime.store.getSnapshot().needsYouLoaded, false);
      assert.equal(runtime.store.getSnapshot().needsYouError, true);
    } finally { runtime.stop(); mock.timers.reset(); }
  `;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', source], {
    cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});

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
