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

test('history failure preserves the cursor, prevents concurrent loads and succeeds on retry', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    let app, pending = Promise.withResolvers();
    const cursors = [];
    mock.module('./packages/tui/src/view/renderer.ts', { namedExports: { launch: async node => {
      app = node.props;
      return { destroy() {} };
    } } });
    mock.module('./packages/tui/src/app.ts', { namedExports: { App: () => null } });
    mock.module('./packages/tui/src/api/client.ts', { namedExports: { DaemonClient: class {
      stream() { return Promise.resolve(); }
      page(collection, cursor) { cursors.push([collection, cursor]); return pending.promise; }
      stop() {}
    } } });
    const { run } = await import('./packages/tui/src/runtime.ts');
    const running = run({ env: { PI_CONSOLE_TOKEN: 'test' } });
    const flush = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); };
    await flush();
    try {
      app.store.apply({ seq: 1, type: 'snapshot', payload: {
        repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], bounded: ['sessions']
      } });
      app.store.mergePage('sessions', { items: [], nextCursor: 'older-cursor', hasMore: true, total: 1 });
      app.loadMore('sessions');
      app.loadMore('sessions');
      assert.deepEqual(cursors, [['sessions', 'older-cursor']]);
      pending.reject(new Error('transient failure'));
      await flush();
      assert.equal(app.store.getSnapshot().history.sessions.error, true);
      assert.equal(app.store.getSnapshot().history.sessions.cursor, 'older-cursor');
      assert.equal(app.store.getSnapshot().history.sessions.more, true);
      assert.equal(app.store.getSnapshot().sessions.length, 0);
      pending = Promise.withResolvers();
      app.loadMore('sessions');
      app.loadMore('sessions');
      assert.deepEqual(cursors, [['sessions', 'older-cursor'], ['sessions', 'older-cursor']]);
      assert.equal(app.store.getSnapshot().history.sessions.error, false);
      pending.resolve({ items: [{ id: 'older' }], nextCursor: null, hasMore: false, total: 1 });
      await flush();
      assert.equal(app.store.getSnapshot().sessions[0].id, 'older');
      assert.equal(app.store.getSnapshot().history.sessions.more, false);
      assert.ok(!app.store.getSnapshot().history.sessions.error);
      app.loadMore('sessions');
      app.loadMore('requests');
      assert.equal(cursors.length, 2);
    } finally { app.onQuit(); await running; }
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
