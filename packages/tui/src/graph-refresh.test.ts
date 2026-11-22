import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Graph } from '@pi-console/contract';
import { graphRefresher } from './graph-refresh.ts';

const flush = async () => { for (let turn = 0; turn < 5; turn++) await Promise.resolve(); };
const graph: Graph = { nodes: [{ laneId: 'lane-only', label: 'Lane only', repositoryId: null }], edges: [] };

test('canonical graph refresh coalesces events, retains data on failure, and does not publish after stop', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let resolve: (value: Graph) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  let calls = 0;
  const published: Graph[] = [];
  const refresh = graphRefresher({ graph: () => new Promise<Graph>((accept, fail) => { calls++; resolve = accept; reject = fail; }) }, value => { published.push(value); }, () => undefined);
  try {
    refresh.request('transcript.appended');
    assert.equal(calls, 0, 'transcript events do not change lane routing');
    refresh.request('snapshot'); refresh.request('message.sent'); refresh.request('session.updated');
    assert.equal(calls, 1);
    resolve(graph);
    await flush();
    assert.deepEqual(published, [graph]);
    mock.timers.tick(2000);
    assert.equal(calls, 2, 'one trailing refresh');
    reject(new Error('offline'));
    await flush();
    assert.deepEqual(published, [graph], 'keep last canonical data on error');
    refresh.request();
    mock.timers.tick(2000);
    assert.equal(calls, 3);
    refresh.stop();
    resolve({ nodes: [], edges: [] });
    await flush();
    assert.deepEqual(published, [graph], 'late response after stop is ignored');
  } finally { refresh.stop(); mock.timers.reset(); }
});
