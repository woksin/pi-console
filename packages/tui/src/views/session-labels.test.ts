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
import { questionsView } from './questions.ts';
import { requestsView } from './requests/requests.ts';
import { workView } from './work.ts';
import { sessionView } from './session.ts';
import type { Env } from './common.ts';

const fixture = generate(192).fixture as unknown as Snapshot;
const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, name: 'aurora implementation', laneId: `L${String(index + 1)}` }));
const resets = sessions.map(session => ({ id: session.id, sessionId: session.id, at: session.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
const requests = sessions.map((session, index) => ({ ...fixture.requests[0], id: `r${String(index)}`, sessionId: session.id }));
const questions = sessions.map((session, index) => ({ ...fixture.questions[0], id: `q${String(index)}`, sessionId: session.id, createdAt: new Date(Date.parse(fixture.generatedAt) - (index + 1) * 86_400_000).toISOString() }));
const jobs = sessions.map((session, index) => ({ ...fixture.jobs[0], id: `j${String(index)}`, sessionId: session.id }));
const messages = [{ ...fixture.messages[0], fromSessionId: sessions[0].id, toSessionId: sessions[1].id, text: 'payload' }];

for (const width of [80, 100, 120, 160]) {
  test(`Session header and subagents keep lane suffixes at ${String(width)} columns`, async () => {
    const store = new Store();
    const [session, subagent] = sessions.map(item => ({ ...item, name: 'aurora implementation '.repeat(8).trim() }));
    const data = { ...store.getSnapshot(), sessions: [session, { ...subagent, parentSessionId: session.id }] };
    const view = sessionView({ data, ui: { ...initial, sessionId: session.id, pane: 'jobs' }, width, height: 70, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined, measure: displayWidth });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 70 });
    try {
      await ui.settle();
      assert.match(ui.frame(), /… · L1\s+updated/);
      if (width >= 110) assert.match(ui.frame(), /↳.*… · L2/);
    } finally { ui.destroy(); store.dispose(); }
  });
  for (const [name, view] of [['Messages', messagesView], ['Timeline', timelineView], ['Questions', questionsView], ['Requests', requestsView], ['Work', workView]] as const) {
    test(`${name} keeps same-name sessions distinguishable at ${String(width)} columns`, async () => {
      const store = new Store();
      store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: { ...fixture, sessions, requests, questions, jobs, resets, messages } });
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
        if (name === 'Questions') {
          assert.match(ui.frame(), /· L1\s+1d\s*│/);
          assert.match(ui.frame(), /· L2\s+2d\s*│/);
        }
      } finally { ui.destroy(); store.dispose(); }
    });
  }
}
