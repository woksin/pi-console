import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '@pi-console/adapters';
import { sessionStarted, specDaemon } from './harness.ts';

/** Synthetic producer files only. Exercises real adapters, polling, projector, REST and SSE. */
export async function memoryDaemon() {
  const root = mkdtempSync(join(tmpdir(), 'pi-console-live-memory-'));
  const memory = join(root, 'memory');
  mkdirSync(join(memory, 'journal'), { recursive: true });
  const spec = await specDaemon([sessionStarted(1, 's1')], {
    ingest: true, agentRoot: root, orchRoot: join(root, 'orch'), laneStatusDir: join(root, 'lanes'),
    sourcePollMs: 20, pollMs: 20, now: () => new Date('2026-11-20T12:00:00Z'),
  });
  let n = 0;
  const append = (file: string, row: Record<string, unknown>) => {
    appendFileSync(file, `\n${JSON.stringify({ ...row, crc: crc32(JSON.stringify(row)) })}\n`);
  };
  const event = (type: string, payload: Record<string, unknown>) => {
    n++;
    append(join(memory, 'events.jsonl'), {
      schema: 'memory.event/2', id: `ev-${n}`, at: new Date(Date.UTC(2026, 10, 20, 9, 0, n)).toISOString(),
      actor: { kind: 'human', id: 'synthetic', harness: 'pi' }, type, ...payload,
    });
  };
  return {
    ...spec, memory,
    add(id = 'live-item', text = 'Synthetic live order') {
      event('add', { item: { id, kind: 'order', scope: { kind: 'session', key: 's1' }, text, source: { type: 'coordinator_order' }, supersedes: [] } });
    },
    confirm: (itemId = 'live-item') => { event('confirm', { itemId }); },
    retire: (itemId = 'live-item') => { event('retire', { itemId, status: 'done', reason: 'synthetic' }); },
    journal(messageId = 'live-message') {
      n++;
      append(join(memory, 'journal/s1.jsonl'), {
        schema: 'memory.journal/2', id: messageId, at: '2026-11-20T10:00:00Z', cwd: '/synthetic', session: { id: 's1', role: 'main' },
        origin: 'human', originEvidence: [], text: 'PRIVATE JOURNAL BODY', withheld: null, redactions: [], textBytes: 20, sha256: 'abc',
      });
    },
    classify: (messageId = 'live-message') => { event('classify', { messageId, whole: 'none', spans: [] }); },
    async close() { try { await spec.close(); } finally { rmSync(root, { recursive: true, force: true }); } },
  };
}
