import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot } from '@pi-console/contract';
import { displayWidth } from '@pi-console/viewmodels';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { h, mountHeadless, Screen } from '../view/renderer.ts';
import { messagesView } from './messages.ts';
import { timelineView } from './timeline.ts';
import type { Env } from './common.ts';

const fixture = generate(192).fixture as unknown as Snapshot;
const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, name: 'aurora implementation', laneId: `L${String(index + 1)}` }));
const resets = sessions.map(session => ({ id: session.id, sessionId: session.id, at: session.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
const messages = [{ ...fixture.messages[0], fromSessionId: sessions[0].id, toSessionId: sessions[1].id, text: 'payload' }];

for (const width of [80, 100, 160]) {
  for (const [name, view] of [['Messages', messagesView], ['Timeline', timelineView]] as const) {
    test(`${name} keeps same-name sessions distinguishable at ${String(width)} columns`, async () => {
      const store = new Store();
      store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: { ...fixture, sessions, requests: [], questions: [], resets, messages } });
      store.flush();
      const env: Env = {
        data: store.getSnapshot(), ui: { ...initial, messagesGraph: false, filter: 'implementation' },
        width, height: 24, now: Date.parse(fixture.generatedAt), measure: displayWidth, phase: 0, click: () => undefined,
      };
      const ui = await mountHeadless(h(Screen, {}, view(env).render()), { width, height: 24 });
      try {
        await ui.settle();
        assert.match(ui.frame(), /… · L1/);
        assert.match(ui.frame(), /… · L2/);
        if (name === 'Messages') assert.match(ui.frame(), /… · L1\s+→\s+aurora.*… · L2/);
      } finally { ui.destroy(); store.dispose(); }
    });
  }
}
