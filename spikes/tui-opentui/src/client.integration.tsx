import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Treat the sibling mock as a black-box fixture, not part of this spike's TS project.
const { startDaemon } = await import(new URL('../../mock-daemon/server.ts', import.meta.url).href);
import { Client } from './client.ts';

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out receiving mock SSE events');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
test('real HTTP + SSE at 5000/s: authenticated snapshot, backfill, bounded live projection', async () => {
  const base = fileURLToPath(new URL('../../../.ai-work/', import.meta.url));
  mkdirSync(base, { recursive: true });
  const daemon = await startDaemon({ port: 0, rate: 5000, dataDirectory: mkdtempSync(`${base}opentui-client-`) });
  const client = new Client(`http://127.0.0.1:${daemon.port}`, daemon.token);
  try {
    client.start();
    await until(() => client.store.state.sessions.length === 30);
    await client.transcript('s2');
    await until(() => (client.store.state.entries.get('s2')?.at(-1)?.cursor ?? 0) > 12000);
    assert.equal(client.store.state.entries.get('s2')!.length, 2500);
    assert.ok(client.store.state.connected);
    assert.ok(client.store.state.requests.some(r => r.id === 'r1' && r.status === 'interrupted'));
    for (const type of ['steer', 'followUp', 'nextTurn', 'answer', 'abort'] as const) {
      const input = type === 'abort'
        ? { type, sessionId: 's2', confirmation: 'L192' }
        : { type, sessionId: 's2', text: 'Preserve history.\nReport evidence.', ...(type === 'answer' ? { questionId: client.store.state.questions.find(q => q.sessionId === 's2')!.id } : {}) };
      const audit = await client.intervene(input);
      assert.equal(audit.result, 'mock-only');
      await until(() => client.store.state.interventions.some(item => item.id === audit.id));
      assert.deepEqual(client.store.state.interventions.find(item => item.id === audit.id), audit);
    }
    await assert.rejects(client.intervene({ type: 'abort', sessionId: 's2', confirmation: 'wrong' }), /HTTP 400/);
  } finally { client.stop(); await daemon.close(); }
});
