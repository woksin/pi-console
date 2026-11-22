import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Graph, Snapshot } from '@pi-console/contract';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { messagesView } from './messages.ts';
import { startHarness } from '../testing/harness.ts';

test('runtime loads the canonical graph endpoint and the Messages graph renders it', async () => {
  const harness = await startHarness({ width: 160, height: 80 });
  try {
    const canonical = await harness.runtime.client.graph();
    for (let wait = 0; wait < 40 && harness.runtime.store.getSnapshot().graph.edges.length === 0; wait++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(harness.runtime.store.getSnapshot().graph, canonical);
    assert.ok(canonical.edges.length > 0);
    await harness.ui.press('5');
    await harness.ui.press('v');
    const frame = await harness.ui.waitFor('Communication graph');
    assert.match(frame, /lanes/);
    assert.match(frame, new RegExp(`×${String(canonical.edges[0].count)}`));
  } finally { await harness.stop(); }
});

const fixture = generate().fixture as unknown as Snapshot;
const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, id: `session-${String(index)}`, laneId: `lane-${String(index)}`, parentSessionId: index ? 'session-0' : null }));
const graph: Graph = {
  nodes: [
    { laneId: 'lane-0', label: 'Lane Zero', repositoryId: 'repo' },
    { laneId: 'lane-1', label: 'Lane One', repositoryId: 'repo' },
    { laneId: 'outside', label: 'Outside', repositoryId: null },
  ],
  edges: [
    { fromLane: 'lane-0', toLane: 'lane-1', kind: 'message', count: 7, lastAt: fixture.generatedAt },
    { fromLane: 'lane-1', toLane: 'lane-0', kind: 'message', count: 2, lastAt: fixture.generatedAt },
    { fromLane: 'outside', toLane: 'lane-0', kind: 'message', count: 1, lastAt: fixture.generatedAt },
  ],
};

for (const width of [80, 160]) for (const cursor of [0, 1, 2]) {
  test(`${String(width)} columns: communication graph uses canonical lane endpoints, with separate session spawn edges (row ${String(cursor)})`, async () => {
    const store = new Store();
    const messages = [
      { ...fixture.messages[0], fromSessionId: 'lane-0', toSessionId: 'lane-1', text: 'forward payload' },
      { ...fixture.messages[1], fromSessionId: 'lane-1', toSessionId: 'lane-0', text: 'reverse payload' },
      { ...fixture.messages[2], fromSessionId: 'outside', toSessionId: 'lane-0', text: 'external payload' },
    ];
    const view = messagesView({ data: { ...store.getSnapshot(), graph, sessions, messages }, ui: { ...initial, section: 'messages', messagesGraph: true, cursor: { ...initial.cursor, messages: cursor } }, width, height: 30, now: Date.parse(fixture.generatedAt), phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width, height: 30 });
    try {
      await ui.settle();
      const frame = ui.frame();
      assert.equal(view.length, 4, 'three directed lane edges and one separate session spawn edge');
      assert.match(frame, /Lane Zero.*▶.*Lane One.*×7/);
      assert.match(frame, /Lane One.*▶.*Lane Zero.*×2/);
      assert.match(frame, /Outside.*▶.*Lane Zero.*×1/);
      assert.match(frame, /Session relationships/);
      if (width >= 110) assert.match(frame, new RegExp(['forward payload', 'reverse payload', 'external payload'][cursor]));
      assert.deepEqual(view.rowAt(cursor), { sessionId: null, groupId: null }, 'a lane is not a session navigation target');
      assert.equal(view.rowAt(3).sessionId, 'session-0');
      assert.equal(view.idAt(cursor), graph.edges[cursor].fromLane);
    } finally { ui.destroy(); store.dispose(); }
  });
}
