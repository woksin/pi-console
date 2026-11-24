import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { questionsView } from './questions.ts';

const fixture = generate().fixture as unknown as Snapshot;
const question = fixture.questions[0];
const sessions = fixture.sessions.map(session => ({ ...session, name: 'A deliberately long readable session name for context', laneId: 'lane-220' }));

for (const width of [80, 100, 120]) {
  for (const expanded of [false, true]) {
    test(`question detail names its session and lane at ${String(width)} columns, expanded=${String(expanded)}`, async () => {
      const store = new Store();
      const view = questionsView({ data: { ...store.getSnapshot(), loaded: true, sessions, questions: [question] }, ui: { ...initial, section: 'questions', terminalWidth: width, questionDetail: expanded || width < 110, questionExpanded: expanded }, width, height: 30, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined });
      const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 30 });
      try {
        await ui.settle();
        const title = ui.frame().split('\n').find(line => line.includes('Question ·'));
        assert.ok(title);
        assert.ok(title.includes('lane-220'), title);
        assert.match(title, /A.* · lane-220/);
        assert.equal(view.rowAt(0).sessionId, question.sessionId);
      } finally { ui.destroy(); store.dispose(); }
    });
  }
}
