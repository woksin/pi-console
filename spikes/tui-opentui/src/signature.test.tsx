import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { getTimelineEngine } from '@opentui/core';
import { App } from './app.tsx';
import { Store, edgeKey, type Snapshot, type Entry, type Intervention } from './model.ts';
import { column, graphEdges, graphMessages, interventionInput, markers, modes, pan, selectGraph, zoom, type GraphSelection } from './signature-model.ts';
import { timeline } from './transcript.tsx';
import { theme } from './theme.ts';

const fixture = JSON.parse(readFileSync(new URL('../../fixture/data/fixture.json', import.meta.url), 'utf8')) as Snapshot & { transcript: Entry[] };
function seeded() {
  const store = new Store();
  store.apply({ seq: 0, type: 'snapshot', payload: structuredClone(fixture) });
  store.append(fixture.transcript); store.flush();
  return store;
}
test('timeline zoom is centered and bounded, pan scales with zoom, markers retain provenance', () => {
  const window = { start: 10000, span: 100000 };
  const closer = zoom(window, .5);
  assert.deepEqual(closer, { start: 35000, span: 50000 });
  assert.deepEqual(zoom(closer, 2), window);
  assert.equal(zoom(window, .0001).span, 5000);
  assert.equal(zoom(window, 1000).span, 3600000);
  assert.deepEqual(pan(pan(window, 1), -1), window);
  assert.equal(pan(closer, 1).start, 42500);
  assert.equal(column(60000, window, 101), 50);
  const signals = markers(seeded().state);
  for (const glyph of ['◆', '●', '╳', '┃', '?', '›', '‹']) assert.ok(signals.some(m => m.glyph === glyph), glyph);
  assert.ok(signals.some(m => m.kind.includes('Unproven origin')));
});
test('graph selection wraps, edge conversation is bidirectional and message SSE pulses', () => {
  const store = seeded();
  const edge = edgeKey('s1', 's2');
  const choices: GraphSelection[] = [{ kind: 'node', id: 's2' }, { kind: 'edge', id: edge }];
  assert.deepEqual(selectGraph(choices, choices[0], -1), choices[1]);
  assert.deepEqual(selectGraph(choices, choices[1], 1), choices[0]);
  assert.deepEqual(selectGraph([], choices[0], 1), choices[0]);
  assert.ok(graphMessages(store.state, choices[1]).every(m => edgeKey(m.fromSessionId, m.toSessionId) === edge));
  const before = store.state.volumes.get(edge)!;
  store.apply({ seq: 1, type: 'message.sent', payload: { ...fixture.messages[0], id: 'new', fromSessionId: 's2', toSessionId: 's1' } });
  assert.equal(store.state.volumes.get(edge), before + 1);
  assert.ok(store.state.pulses.get(edge)! <= Date.now());
  assert.equal(graphEdges(store.state, fixture.sessions).find(e => e.id === edge)?.count, before + 1);
  assert.equal(graphMessages(store.state, choices[0]).filter(m => m.id === 'new').length, 1);
});
test('composer validates every API mode including destructive confirmation and question target', () => {
  const session = fixture.sessions.find(s => s.id === 's2')!;
  for (const mode of modes.filter(m => m !== 'abort')) {
    assert.equal(interventionInput(session, mode, 'line one\nline two', 'q1').text, 'line one\nline two');
  }
  assert.throws(() => interventionInput(session, 'steer', '  '), /Write a message/);
  assert.throws(() => interventionInput(session, 'answer', 'answer'), /No open question/);
  assert.throws(() => interventionInput(session, 'steer', 'x'.repeat(10001)), /10,000/);
  assert.throws(() => interventionInput(session, 'abort', '', undefined, 'wrong'), /confirm abort/);
  assert.deepEqual(interventionInput(session, 'abort', '', undefined, session.laneId), { type: 'abort', sessionId: session.id, confirmation: session.laneId });
});
test('thinking and tool disclosure is independent per entry', () => {
  const store = seeded();
  const entries = fixture.transcript.filter(e => ['thinking', 'tool.call', 'tool.result'].includes(e.kind)).slice(0, 3);
  const lines = timeline(entries, store.state, theme('truecolor'), 90, new Set([entries[1].id]));
  assert.equal(lines.filter(l => l.id === entries[0].id).length, 1);
  assert.ok(lines.filter(l => l.id === entries[1].id).length > 1);
  assert.equal(lines.filter(l => l.id === entries[2].id).length, 1);
});
test('native signature navigation, zoom/pan, collapse, graph edge, composer submit + streamed audit, narrow stack', async () => {
  const store = seeded();
  let submitted = 0;
  const ui = await testRender(<App store={store} submit={async input => {
    submitted++;
    assert.equal(input.text, 'Please preserve the audit trail.\nReport the outcome.');
    const audit = { id: 'audit-test', ...input, result: 'mock-only', recordedAt: new Date().toISOString() } as Intervention;
    store.apply({ seq: 1, type: 'intervention.recorded', payload: audit }); store.flush();
    return audit;
  }} />, { width: 120, height: 36 });
  const key = async (name: string, ctrl = false) => {
    await act(async () => {
      ui.mockInput.pressKey(name, { ctrl });
      if (name === 'ESCAPE') await new Promise(resolve => setTimeout(resolve, 40));
    });
    await act(async () => { getTimelineEngine(ui.renderer).update(700); });
  };
  try {
    await key('t');
    await ui.waitForFrame(f => f.includes('TIME / SIGNAL') && f.includes('150s window'));
    await key('+');
    await ui.waitForFrame(f => f.includes('98s window'));
    const before = ui.captureCharFrame();
    await key('l'); await ui.flush();
    assert.notEqual(ui.captureCharFrame(), before);
    await key('c'); await ui.flush();
    assert.ok(ui.captureCharFrame().includes('▸ aurora'));
    await key('c');
    await key('RETURN');
    await ui.waitForFrame(f => f.includes('TRANSCRIPT') && f.includes('PAUSED'));
    await key(']'); await key('RETURN');
    await ui.waitForFrame(f => f.includes('▾'));
    await key('g');
    await ui.waitForFrame(f => f.includes('NEURAL / MESH'));
    for (let i = 0; i < 4; i++) await key('j');
    await ui.waitForFrame(f => f.includes('CONVERSATION'));
    await act(async () => ui.resize(90, 30));
    await ui.waitForFrame(f => f.includes('NEURAL / MESH') && f.includes('CONVERSATION'));
    await key('i');
    await ui.waitForFrame(f => f.includes('HUMAN IN THE LOOP'));
    await act(async () => ui.mockInput.typeText('Please preserve the audit trail.'));
    await key('RETURN');
    await act(async () => ui.mockInput.typeText('Report the outcome.'));
    await key('s', true);
    await ui.waitForFrame(f => f.includes('intervention.recorded arrived on SSE'));
    assert.equal(submitted, 1);
    await key('ESCAPE');
    await key('ESCAPE');
    await key('RETURN');
    await ui.waitForFrame(f => f.includes('TRANSCRIPT') && f.includes('NEVER-LOST LOG'));
  } finally { await act(async () => ui.dispose()); }
});
