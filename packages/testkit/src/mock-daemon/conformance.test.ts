import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { daemonConformance } from '../conformance/daemon-conformance.ts';
import { startDaemon } from './server.ts';

// The timeline is effectively frozen (tiny speed) so the only deltas are the ones the suite emits.
daemonConformance('mock daemon', {
  async start({ replayWindow }) {
    const directory = mkdtempSync(join(tmpdir(), 'pi-console-mock-conformance-'));
    const daemon = await startDaemon({ port: 0, speed: 1e-9, dataDirectory: directory, replayWindow });
    await delay(30);
    const attentionSessionId = 'conformance-attention';
    daemon.store.publish('session.updated', { ...daemon.store.fixture.sessions[0], id: attentionSessionId, status: 'idle' });
    return {
      port: daemon.port, address: daemon.address, token: daemon.token,
      async emit() { daemon.store.publish('session.updated', daemon.store.fixture.sessions[0]); },
      attentionSessionId,
      async emitAttention(kind, open) {
        if (kind === 'request') {
          daemon.store.publish('request.observed', { ...daemon.store.fixture.requests[0], id: 'conformance-request', sessionId: attentionSessionId,
            origin: 'launch', status: open ? 'open' : 'answered', answer: null });
        } else {
          daemon.store.publish('question.asked', { ...daemon.store.fixture.questions[0], id: 'conformance-question', sessionId: attentionSessionId,
            blocking: true, status: open ? 'open' : 'answered' });
        }
      },
      async close() { await daemon.close(); rmSync(directory, { recursive: true, force: true }); },
    };
  },
});
