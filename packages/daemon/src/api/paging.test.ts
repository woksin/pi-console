import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call } from '@pi-console/testkit';
import { specDaemon } from '../testing/harness.ts';

interface Paged { items: { id: string }[]; nextCursor: string | null; hasMore: boolean; total: number }

test('without limit every list is complete and unchanged; with limit it is a keyset page', async () => {
  const spec = await specDaemon();
  try {
    const headers = { Authorization: `Bearer ${spec.token}` };
    const get = (path: string) => call(spec.daemon.port, `/api/v1${path}`, { headers });
    for (const name of ['jobs', 'messages', 'requests', 'questions', 'sessions']) {
      const complete = (await get(`/${name}`)).body as { items: { id: string }[]; hasMore?: unknown };
      assert.deepEqual(Object.keys(complete), ['items'], name);
      const walked: string[] = [];
      let after: string | null = null;
      do {
        const reply = await get(`/${name}?limit=7${after ? `&after=${after}` : ''}`);
        assert.equal(reply.status, 200, name);
        const page = reply.body as Paged;
        assert.equal(page.total, complete.items.length);
        walked.push(...page.items.map(item => item.id));
        after = page.nextCursor;
      } while (after);
      assert.deepEqual(walked, complete.items.map(item => item.id), name);
      const descending = (await get(`/${name}?limit=1000&order=desc`)).body as Paged;
      assert.deepEqual(descending.items.map(item => item.id), complete.items.map(item => item.id).reverse(), name);
    }
  } finally { await spec.close(); }
});

test('bad paging parameters are 400', async () => {
  const spec = await specDaemon();
  try {
    const headers = { Authorization: `Bearer ${spec.token}` };
    for (const query of ['limit=0', 'limit=1001', 'limit=x', 'limit=5&order=up', 'limit=5&after=garbage', 'limit=5&filter=nope']) {
      const reply = await call(spec.daemon.port, `/api/v1/requests?${query}`, { headers });
      assert.equal(reply.status, 400, query);
    }
  } finally { await spec.close(); }
});
