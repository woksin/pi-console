import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphViewModel } from './graph.ts';
import { fixture, golden } from '../test-support.ts';
import type { Graph } from '@pi-console/contract';

const laneGraph: Graph = {
  nodes: [
    { laneId: 'lane-a', label: 'Lane A', repositoryId: 'repo' },
    { laneId: 'lane-b', label: 'Lane B', repositoryId: 'repo' },
    { laneId: 'no-session', label: 'No session', repositoryId: null },
  ],
  edges: [
    { fromLane: 'lane-a', toLane: 'lane-b', kind: 'message', count: 6, lastAt: '2026-01-01T00:00:03Z' },
    { fromLane: 'lane-b', toLane: 'lane-a', kind: 'message', count: 2, lastAt: '2026-01-01T00:00:02Z' },
    { fromLane: 'no-session', toLane: 'lane-a', kind: 'message', count: 1, lastAt: '2026-01-01T00:00:01Z' },
  ],
};

test('canonical lane graph preserves direction, counts and endpoints independently of sessions', () => {
  const model = graphViewModel({ graph: laneGraph });
  assert.equal(model.groups.reduce((sum, group) => sum + group.messages, 0), 9);
  assert.deepEqual(model.groups[0].edges, laneGraph.edges.slice(0, 2).map(edge => ({ ...edge, thickness: edge.count === 6 ? 3 : 2 })));
  const unassigned = model.groups.find(group => group.repositoryId === null);
  assert.equal(unassigned?.edges[0].fromLane, 'no-session');
  assert.deepEqual(unassigned?.nodes.map(node => node.laneId).sort(), ['lane-a', 'no-session']);
});

test('graph aggregates messages per pair and adds spawn edges, grouped by repository', () => {
  const model = graphViewModel({ sessions: fixture.sessions, messages: fixture.messages });
  assert.ok(model.groups.length > 0);
  const total = model.groups.reduce((sum, group) => sum + group.messages, 0);
  assert.equal(total, fixture.messages.length);
  assert.ok(model.groups.some(group => group.edges.some(edge => edge.kind === 'spawn')));
  for (const group of model.groups) for (const edge of group.edges) assert.ok(group.nodes.some(node => node.sessionId === edge.from));
  golden('graph', model);
});
