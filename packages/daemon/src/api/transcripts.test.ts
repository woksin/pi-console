import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';

test('async transcript readers retain page/window response shapes and missing-window status', async t => {
  const page = { items: [], nextCursor: 7, hasMore: false };
  const calls: unknown[][] = [];
  const spec = await specDaemon(undefined, { transcripts: {
    async page(...args) { calls.push(args); await Promise.resolve(); return page; },
    async around(...args) { calls.push(args); await Promise.resolve(); return args[1] === 'known' ? page : undefined; },
  } });
  t.after(() => spec.close());
  const get = (query: string) => call(spec.daemon.port, `/api/v1/sessions/s1/transcript?${query}`, { headers: { Authorization: `Bearer ${spec.token}` } });
  assert.deepEqual((await get('after=3&limit=5')).body, page);
  assert.deepEqual((await get('order=desc&limit=5')).body, page);
  assert.deepEqual((await get('order=desc&after=9&limit=1')).body, page);
  assert.equal((await get('order=wrong')).status, 400);
  assert.deepEqual((await get('around=known&limit=5')).body, page);
  assert.equal((await get('around=missing')).status, 404);
  assert.deepEqual(calls, [['s1', 3, 5], ['s1', Number.MAX_SAFE_INTEGER, 5, 'desc'], ['s1', 9, 1, 'desc'], ['s1', 'known', 5], ['s1', 'missing', 100]]);
});
