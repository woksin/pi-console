import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { throttled } from './refresh.ts';

const flush = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };

test('an event inside the throttle window still ends in a trailing refresh', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    let calls = 0;
    const refresher = throttled(async () => { calls += 1; }, 2000);
    refresher.request();
    await flush();
    assert.equal(calls, 1);
    mock.timers.tick(100);
    refresher.request();
    await flush();
    assert.equal(calls, 1, 'throttled, not yet');
    mock.timers.tick(1900);
    await flush();
    assert.equal(calls, 2, 'the trailing refresh fired when the window ended');
    mock.timers.tick(10_000);
    await flush();
    assert.equal(calls, 2, 'no extra refresh without a new request');
  } finally { mock.timers.reset(); }
});

test('a request during an in-flight load is served after it, and stop cancels the trailing refresh', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    let calls = 0;
    let release: () => void = () => undefined;
    const refresher = throttled(() => new Promise<void>(resolve => { calls += 1; release = resolve; }), 2000);
    refresher.request();
    refresher.request();
    assert.equal(calls, 1, 'no overlap');
    release();
    await flush();
    mock.timers.tick(2000);
    await flush();
    assert.equal(calls, 2);
    release();
    await flush();
    refresher.request();
    refresher.stop();
    mock.timers.tick(10_000);
    await flush();
    assert.equal(calls, 2, 'stopped');
  } finally { mock.timers.reset(); }
});
