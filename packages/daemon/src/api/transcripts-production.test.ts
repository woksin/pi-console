import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from '@pi-console/testkit';
import { apiV1Schema, validate, type Transcript, type RequestPage } from '@pi-console/contract';
import { specDaemon } from '../testing/harness.ts';

const at = new Date().toISOString();
const line = (value: unknown) => JSON.stringify(value) + '\n';
const message = (id: string, role: string, content: string) => ({ type: 'message', id, timestamp: at, message: { role, content, stopReason: 'stop' } });

test('production startup, answer anchor, paging, append and checkpoint-only restart', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pi-history-production-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'not-the-session-id.jsonl');
  writeFileSync(path, line({ type: 'session', version: 3, id: 'history', timestamp: at, cwd: '/synthetic' }) +
    line(message('prompt', 'user', 'hello')) + line(message('answer', 'assistant', 'real answer')) +
    line({ type: 'message', id: 'result', timestamp: at, message: { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: 'safe result' } }) +
    line({ type: 'compaction', id: 'reset', timestamp: at, summary: 'summary' }));
  const spec = await specDaemon([], { ingest: true, sessionRoots: [root], pollMs: 10 });
  let running = spec.daemon;
  t.after(() => spec.close());
  const get = (route: string) => call(running.port, '/api/v1' + route, { headers: { Authorization: `Bearer ${spec.token}` } });
  assert.equal((await call(running.port, '/api/v1/sessions/history/transcript')).status, 401);
  let requests: RequestPage | undefined;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    requests = (await get('/requests')).body as RequestPage;
    if (requests.items.some(item => item.status === 'answered')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const request = requests?.items.find(item => item.status === 'answered');
  assert.ok(request, 'ingestion must derive an answered request');
  const anchor = request.evidence?.find(item => item.kind === 'answer')?.entryId;
  assert.equal(anchor, 'answer');
  const response = await get(`/sessions/history/transcript?around=${anchor}&limit=3`);
  assert.equal(response.status, 200);
  validate(response.body, apiV1Schema.$defs.transcript, apiV1Schema);
  assert.ok((response.body as Transcript).items.some(item => item.id === anchor && item.text === 'real answer'));
  const ids: string[] = [];
  let after = 0;
  for (let page = 0; page < 10; page++) {
    const result = (await get(`/sessions/history/transcript?after=${after}&limit=1`)).body as Transcript;
    ids.push(...result.items.map(item => item.id));
    assert.ok(result.items.every(item => item.cursor > after));
    after = result.nextCursor;
    if (!result.hasMore) break;
  }
  assert.deepEqual(ids, ['prompt', 'answer', 'result', 'reset']);
  assert.equal((await get('/sessions/history/transcript?around=missing')).status, 404);
  assert.equal((await get('/sessions/unknown/transcript')).status, 404);
  appendFileSync(path, line(message('appended', 'user', 'visible without restart')));
  assert.equal(((await get(`/sessions/history/transcript?after=${after}`)).body as Transcript).items[0]?.id, 'appended');
  await running.close();
  const { startDaemon } = await import('../daemon.ts');
  const { defaultConfig } = await import('../config.ts');
  running = await startDaemon({ ...defaultConfig(spec.directory), port: 0, ingest: false, sessionRoots: [root], agentRoot: join(root, 'none'), orchRoot: join(root, 'none') });
  // The harness still owns final shutdown and temporary database cleanup.
  spec.daemon.close = () => running.close();
  assert.ok(((await get('/sessions/history/transcript?path=/etc/passwd')).body as Transcript).items.some(item => item.id === 'answer'));
  rmSync(path);
  assert.deepEqual((await get('/sessions/history/transcript')).body, { items: [], nextCursor: 0, hasMore: false });
  assert.equal((await get('/sessions/history/transcript?around=answer')).status, 404);
});
