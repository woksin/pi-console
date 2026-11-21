import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '@pi-console/adapters';
import { testEvent } from '@pi-console/core/testing';
import { defaultConfig, startDaemon } from '@pi-console/daemon';
import { App } from './app.ts';
import { connect } from './runtime.ts';
import { h, mountHeadless } from './view/renderer.ts';
import { palette } from './view/theme.ts';

// Keep this fixture local: importing another project's private testing source breaks composite project boundaries.
async function memoryDaemon() {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-tui-memory-'));
  const tokenPath = join(root, 'daemon/token');
  const memory = join(root, 'memory'); mkdirSync(join(memory, 'journal'), { recursive: true });
  const daemon = await startDaemon({
    config: { ...defaultConfig, port: 0, bindAddress: '127.0.0.1', databasePath: ':memory:', tokenPath,
      sessionRoots: [], agentRoot: root, orchRoot: join(root, 'orch'), laneStatusDir: join(root, 'lanes'), sourcePollMs: 20, pollMs: 20 },
    now: () => new Date('2026-11-20T12:00:00Z'),
  });
  await daemon.log.append([testEvent(1, 'SessionStarted', { sessionId: 's1', repositoryId: 'repo', name: 'Synthetic session',
    laneId: 'lane', role: 'main', parentSessionId: null, orchestratorSessionId: 's1', branch: 'main', cwd: '/synthetic', model: 'test' })]);
  let seq = 0;
  const append = (file: string, row: Record<string, unknown>) => { appendFileSync(file, `${JSON.stringify({ ...row, crc: crc32(JSON.stringify(row)) })}\n`); };
  const event = (type: string, payload: Record<string, unknown>) => {
    seq++;
    append(join(memory, 'events.jsonl'), { schema: 'memory.event/2', id: `e${seq}`, at: new Date(Date.UTC(2026, 10, 20, 9, 0, seq)).toISOString(), actor: { kind: 'human', id: 'test', harness: 'pi' }, type, ...payload });
  };
  return {
    daemon, headers: { Authorization: `Bearer ${readFileSync(tokenPath, 'utf8').trim()}` },
    add: () => { event('add', { item: { id: 'live-item', kind: 'order', scope: { kind: 'session', key: 's1' }, text: 'Synthetic live order', source: { type: 'coordinator_order' }, supersedes: [] } }); },
    confirm: () => { event('confirm', { itemId: 'live-item' }); },
    retire: () => { event('retire', { itemId: 'live-item', status: 'done', reason: 'synthetic' }); },
    journal: () => { append(join(memory, 'journal/s1.jsonl'), { schema: 'memory.journal/2', id: 'live-message', at: '2026-11-20T10:00:00Z', cwd: '/synthetic', session: { id: 's1', role: 'main' }, origin: 'human', originEvidence: [], text: 'PRIVATE JOURNAL BODY', withheld: null, redactions: [], textBytes: 20, sha256: 'abc' }); },
    classify: () => { event('classify', { messageId: 'live-message', whole: 'none', spans: [] }); },
    async close() { await daemon.stop(); daemon.log.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('visible headless memory panel follows real producer appends; hidden pane catches up on reopen', { timeout: 15000 }, async () => {
  const spec = await memoryDaemon();
  const runtime = connect({ baseUrl: `http://127.0.0.1:${String(spec.daemon.port)}`, token: spec.headers.Authorization.slice(7), tokenSource: 'test' });
  palette.configure('truecolor', 'midnight');
  const ui = await mountHeadless(h(App, {
    store: runtime.store, endpoint: 'synthetic', tokenSource: 'test', animate: false,
    loadTranscript: () => undefined, loadMemory: id => { void runtime.loadMemory(id); }, watchMemory: runtime.watchMemory,
    loadMore: collection => { void runtime.store.loadMore(runtime.client, collection); }, onQuit: () => undefined,
  }), { width: 160, height: 42 });
  try {
    await ui.waitFor('◉ live');
    await ui.press('2'); await ui.waitFor('Fleet ·');
    await ui.press('RETURN'); await ui.waitFor('Transcript');
    for (let n = 0; n < 4; n++) await ui.press('TAB');
    await ui.waitFor('No intent-memory store seen');
    spec.add();
    await ui.waitFor('Synthetic live order');
    assert.equal(runtime.store.getSnapshot().memoryItems.get('s1')?.[0].status, 'proposed');
    spec.confirm();
    await ui.waitFor(frame => /active[\s\S]*Synthetic live order/i.test(frame));
    assert.equal(runtime.store.getSnapshot().memoryItems.get('s1')?.[0].status, 'active');
    assert.equal(Object.hasOwn(runtime.store.getSnapshot().sessions[0], 'memoryChanged'), false);
    spec.journal(); await ui.waitFor('unresolved: 1+');
    spec.classify(); await ui.waitFor('unresolved: 0+');
    await ui.press('ESCAPE'); await ui.waitFor('Fleet ·');
    spec.retire();
    // Canonical REST advances while the panel is closed; reopening must fetch independently of later SSE.
    for (let n = 0; n < 150; n++) {
      if ((await runtime.client.memoryItems('s1'))[0]?.status === 'done') break;
      await new Promise(resolve => { setTimeout(resolve, 20); });
    }
    await ui.press('RETURN');
    // The pane selection is retained across back/open in this UI.
    if (!ui.frame().includes('Synthetic live order')) for (let n = 0; n < 4; n++) await ui.press('TAB');
    await ui.waitFor(frame => /done[\s\S]*Synthetic live order/i.test(frame));
    assert.equal(runtime.store.getSnapshot().memoryItems.get('s1')?.[0].status, 'done');
    assert.equal(ui.frame().includes('PRIVATE JOURNAL BODY'), false);
  } finally { ui.destroy(); runtime.stop(); await spec.close(); }
});
