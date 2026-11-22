import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Graph, Snapshot } from '@pi-console/contract';
import { App } from '../app.ts';
import { Store } from '../store/store.ts';
import { initial } from '../state/ui.ts';
import { Screen, h, mountHeadless } from '../view/renderer.ts';
import { messagesView } from './messages.ts';
import { startHarness } from '../testing/harness.ts';
import { graphScrubber } from './graph-scrubber.ts';
import type { Env } from './common.ts';

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
const sessions = fixture.sessions.slice(0, 4).map((session, index) => ({ ...session, id: `session-${String(index)}`, laneId: ['lane-0', 'lane-1', 'outside', 'lane-0'][index], parentSessionId: index === 1 ? 'session-0' : null }));
const messages = [
  { ...fixture.messages[0], fromSessionId: 'session-0', toSessionId: 'session-1', text: 'forward payload' },
  { ...fixture.messages[1], fromSessionId: 'session-1', toSessionId: 'session-0', text: 'reverse payload' },
  { ...fixture.messages[2], fromSessionId: 'session-2', toSessionId: 'session-0', text: 'external payload' },
  { ...fixture.messages[3], fromSessionId: 'session-3', toSessionId: 'session-1', text: 'same-lane payload' },
  { ...fixture.messages[4], fromSessionId: 'unknown-lane', toSessionId: 'lane-1', text: 'unknown-lane payload' },
  { ...fixture.messages[5], fromSessionId: 'unknown-session', toSessionId: 'session-1', text: 'unknown payload' },
];
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

function assertRecent(frame: string, cursor: number): void {
  assert.match(frame, /Recent/i);
  assert.match(frame, new RegExp(['forward payload', 'reverse payload', 'external payload'][cursor]));
  assert.doesNotMatch(frame, /unknown-lane payload|unknown payload/);
  if (cursor === 0) {
    assert.match(frame, /same-lane payload/);
    assert.doesNotMatch(frame, /reverse payload|external payload/);
  }
}

for (const width of [80, 112, 160]) for (const cursor of [0, 1, 2]) {
  test(`${String(width)} columns: communication graph uses canonical lane endpoints, with separate session spawn edges (row ${String(cursor)})`, async () => {
    const store = new Store();
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
      if (width >= 110) assertRecent(frame, cursor);
      assert.deepEqual(view.rowAt(cursor), { sessionId: null, groupId: null }, 'a lane is not a session navigation target');
      assert.equal(view.rowAt(3).sessionId, 'session-0');
      assert.equal(view.idAt(cursor), graph.edges[cursor].fromLane);
    } finally { ui.destroy(); store.dispose(); }
  });
}

const activityGraph: Graph = { ...graph, edges: graph.edges.map((edge, index) => ({ ...edge, lastAt: new Date(Date.parse(fixture.generatedAt) + index * 60_000).toISOString() })) };
const now = Date.parse(activityGraph.edges[2].lastAt);

function graphEnv(source: Graph, scrubColumn = 0): Env {
  const store = new Store();
  return { data: { ...store.getSnapshot(), graph: source, sessions, messages }, ui: { ...initial, section: 'messages', messagesGraph: true, scrub: true, scrubColumn }, width: 80, height: 24, now, phase: 0, click: () => undefined };
}

for (const source of [
  { name: 'daemon lane IDs', from: 'lane-0', to: 'lane-1', sessions: [] },
  { name: 'session IDs', from: 'session-0', to: 'session-1', sessions },
  { name: 'mixed lane and session IDs', from: 'session-0', to: 'lane-1', sessions },
]) {
  test(`Recent lists messages with ${source.name} for the selected lane edge`, async () => {
    const env = graphEnv(graph);
    const message = { ...fixture.messages[0], fromSessionId: source.from, toSessionId: source.to };
    const messages = [
      { ...message, text: 'selected edge payload' },
      { ...message, fromSessionId: source.to, toSessionId: source.from, text: 'reverse edge payload' },
      { ...message, fromSessionId: 'unknown-lane', text: 'unknown sender payload' },
      { ...message, toSessionId: 'unknown-lane', text: 'unknown recipient payload' },
    ];
    const view = messagesView({ ...env, data: { ...env.data, messages, sessions: source.sessions }, width: 112 });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 112, height: 24 });
    try {
      await ui.settle();
      assert.match(ui.frame(), /Recent/i);
      assert.match(ui.frame(), /selected edge payload/);
      assert.doesNotMatch(ui.frame(), /reverse edge payload|unknown sender payload|unknown recipient payload/);
    } finally { ui.destroy(); }
  });
}

test('last-activity cutoff includes its boundary, retains all-time counts and never filters session spawn edges', () => {
  const env = graphEnv(activityGraph);
  const first = messagesView(env);
  assert.equal(first.length, 2, 'oldest lane edge plus the session spawn edge');
  assert.equal(first.idAt(0), 'lane-0');
  assert.equal(first.rowAt(1).sessionId, 'session-0');
  const latest = messagesView({ ...env, ui: { ...env.ui, scrubColumn: first.time!.width - 1 } });
  assert.equal(latest.length, 4);
  assert.equal(graphScrubber(env).upTo, Date.parse(activityGraph.edges[0].lastAt));
  assert.equal(graphScrubber({ ...env, ui: { ...env.ui, scrubColumn: 10_000 } }).upTo, now, 'resizing clamps to the newest edge');
});

test('empty and single-activity graphs have a visible, finite scrubber', () => {
  const empty = graphScrubber(graphEnv({ nodes: [], edges: [] }));
  assert.equal(empty.upTo, 0);
  assert.match(empty.lines.flat().map(part => part.text).join(''), /no edge activity.*t\/Esc hide/);
  const one = graphScrubber(graphEnv({ ...graph, edges: [activityGraph.edges[0]] }));
  assert.equal(one.upTo, Date.parse(activityGraph.edges[0].lastAt));
  assert.match(one.lines.flat().map(part => part.text).join(''), /counts are all-time/);
});

async function mountActivityGraph(width: number, cursor = 0) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: { ...fixture, sessions, messages } });
  store.setGraph(activityGraph);
  store.setConnection(true, '');
  store.setNeedsYou([]);
  store.flush();
  const opened: string[] = [];
  const ui = await mountHeadless(h(App, {
    store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, clock: () => now,
    initialState: { section: 'messages', messagesGraph: true, cursor: { ...initial.cursor, messages: cursor } },
    loadTranscript: (id: string) => { opened.push(id); }, loadMemory: () => undefined, onQuit: () => undefined,
  }), { width, height: 24 });
  await ui.settle();
  return { store, ui, opened };
}

test('scrubbing clamps activation and copy selection to the highlighted remaining edge', async () => {
  const env = graphEnv(activityGraph);
  const view = messagesView({ ...env, ui: { ...env.ui, cursor: { ...initial.cursor, messages: 3 } } });
  assert.equal(view.length, 2);
  assert.equal(view.rowAt(3).sessionId, 'session-0');
  assert.equal(view.idAt(3), 'session-0');
  const { ui, store, opened } = await mountActivityGraph(112, 3);
  try {
    await ui.press('t');
    await ui.press('h');
    assert.match(ui.frame(), /3 edges/);
    assert.match(ui.frame(), /▌.*spawn/);
    await ui.press('RETURN');
    assert.deepEqual(opened, ['session-0']);
  } finally { ui.destroy(); store.dispose(); }
});

test('an empty scrubbed graph has no activation or copy target', () => {
  const env = graphEnv({ nodes: [], edges: [] });
  const view = messagesView({ ...env, data: { ...env.data, sessions: [] } });
  assert.equal(view.length, 0);
  assert.deepEqual(view.rowAt(3), { sessionId: null, groupId: null });
  assert.equal(view.idAt(3), null);
});

const snapshotFrame = (frame: string): string => frame.split('\n').map(line => line.trimEnd()).join('\n').trimEnd();

for (const width of [80, 112]) {
  test(`${String(width)} columns: t shows the last-activity scrubber, movement filters edges and Esc restores the graph`, async context => {
    const { ui, store } = await mountActivityGraph(width);
    try {
      const before = ui.frame();
      await ui.press('h');
      assert.equal(ui.frame(), before, 'movement keys are scoped to the active scrubber');
      await ui.press('t');
      const latest = ui.frame();
      assert.match(latest, /Last-activity cutoff.*counts are all-time/);
      assert.match(latest, /h\/← earlier.*l\/→ later.*t\/Esc hide/);
      assert.match(latest, /4 edges/);
      context.assert.snapshot(snapshotFrame(latest));
      await ui.press('h');
      const earlier = ui.frame();
      assert.match(earlier, /3 edges/);
      assert.doesNotMatch(earlier, /Outside.*▶/);
      assert.match(earlier, /×7/);
      assert.match(earlier, /Session relationships/);
      context.assert.snapshot(snapshotFrame(earlier));
      await ui.press('l');
      assert.equal(ui.frame(), latest);
      await ui.press('ARROW_LEFT');
      assert.equal(ui.frame(), earlier);
      await ui.press('ARROW_RIGHT');
      assert.equal(ui.frame(), latest);
      await ui.press('ESCAPE');
      assert.equal(ui.frame(), before);
    } finally { ui.destroy(); store.dispose(); }
  });
}

test('lists show Loading… before the first snapshot and a no-match line for a filter that hides every row', async () => {
  const store = new Store();
  const render = async (data: Env['data'], filter: string) => {
    const view = messagesView({ data, ui: { ...initial, section: 'messages', filter }, width: 100, height: 24, now: 0, phase: 0, click: () => undefined });
    const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 24 });
    try { await ui.settle(); return ui.frame(); } finally { ui.destroy(); }
  };
  try {
    assert.match(await render(store.getSnapshot(), ''), /Loading…/);
    const frame = await render({ ...store.getSnapshot(), loaded: true, messages: [{ id: 'm1', fromSessionId: 'a', toSessionId: 'b', kind: 'text', text: 'hello', sentAt: '2026-01-01T00:00:00Z' } as unknown as Env['data']['messages'][number]] }, 'zzz');
    assert.match(frame, /No message matches/);
  } finally { store.dispose(); }
});

test('a failed graph read says so, offers r to retry and keeps the last graph', async () => {
  const store = new Store();
  store.markGraphFailed();
  const view = messagesView({ data: store.getSnapshot(), ui: { ...initial, section: 'messages', messagesGraph: true }, width: 100, height: 24, now: 0, phase: 0, click: () => undefined });
  const ui = await mountHeadless(h(Screen, {}, view.render()), { width: 100, height: 24 });
  try {
    await ui.settle();
    assert.match(ui.frame(), /Could not load the graph/);
    assert.match(ui.frame(), /r retry/);
    assert.doesNotMatch(ui.frame(), /Loading…/);
  } finally { ui.destroy(); store.dispose(); }
});
