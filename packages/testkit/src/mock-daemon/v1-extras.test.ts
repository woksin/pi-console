import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { generate } from '../fixture/generate.ts';
import { createStore } from './store.ts';
import { graph, health } from './v1-extras.ts';

test('mock health reports available sample sources with fixture poll times', t => {
  const store = createStore(1);
  t.after(() => { store.close(); });
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  t.after(() => { histogram.disable(); });
  const report = health(store, new Date().toISOString(), 10000, histogram);
  assert.equal(report.agentRootAvailability, 'available');
  assert.deepEqual(report.sources.map(source => source.source), ['session-jsonl', 'issue-work', 'lane-messages']);
  for (const source of report.sources) {
    assert.equal(source.files, 12);
    assert.equal(source.lagBytes, 0);
    assert.equal(source.errors, 0);
    assert.equal(source.availability, 'available');
    assert.equal(source.lastPollAt, store.fixture.generatedAt);
  }
});

test('mock graph includes waiting-on and barred-by dependencies to known parent/coordinator lanes', () => {
  const fixture = generate().fixture;
  const base = fixture.sessions[0];
  fixture.sessions = [
    { ...base, id: 'parent', laneId: 'L0', status: 'working', parentSessionId: null, orchestratorSessionId: 'parent' },
    { ...base, id: 'waiting', laneId: 'L192', status: 'waiting', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
    { ...base, id: 'blocked', laneId: 'L193', status: 'blocked', parentSessionId: null, orchestratorSessionId: 'parent' },
    { ...base, id: 'unknown', laneId: 'L194', status: 'waiting', parentSessionId: 'missing' },
  ];
  fixture.messages = [];
  assert.deepEqual(graph(fixture).edges, [
    { fromLane: 'L193', toLane: 'L0', kind: 'barred-by', count: 1, lastAt: base.updatedAt },
    { fromLane: 'L192', toLane: 'L0', kind: 'waiting-on', count: 1, lastAt: base.updatedAt },
  ]);
});

test('mock graph orders edges by the composite kind|from|to key, like the core query', () => {
  const fixture = generate().fixture;
  const base = fixture.sessions[0];
  fixture.sessions = [
    { ...base, id: 'parent', laneId: 'L0', status: 'working', parentSessionId: null, orchestratorSessionId: 'parent' },
    { ...base, id: 'one', laneId: 'L1', status: 'waiting', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
    { ...base, id: 'ten', laneId: 'L10', status: 'waiting', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
  ];
  fixture.messages = [];
  assert.deepEqual(graph(fixture).edges.map(edge => edge.fromLane), ['L10', 'L1']);
});

test('mock graph retains raw lane endpoints with no sessions and aggregates directed counts', () => {
  const fixture = generate().fixture;
  const message = fixture.messages[0];
  fixture.sessions = [];
  fixture.messages = [
    { ...message, id: 'm1', fromSessionId: 'L0', toSessionId: 'L192', sentAt: '2026-01-01T00:00:01Z' },
    { ...message, id: 'm2', fromSessionId: 'L0', toSessionId: 'L192', sentAt: '2026-01-01T00:00:03Z' },
    { ...message, id: 'm3', fromSessionId: 'L192', toSessionId: 'L0', sentAt: '2026-01-01T00:00:02Z' },
  ];
  assert.deepEqual(graph(fixture), {
    nodes: [{ laneId: 'L0', label: 'L0', repositoryId: null }, { laneId: 'L192', label: 'L192', repositoryId: null }],
    edges: [
      { fromLane: 'L0', toLane: 'L192', kind: 'message', count: 2, lastAt: '2026-01-01T00:00:03Z' },
      { fromLane: 'L192', toLane: 'L0', kind: 'message', count: 1, lastAt: '2026-01-01T00:00:02Z' },
    ],
  });
});
