import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Graph, Session } from '@pi-console/contract';
import { generate } from '@pi-console/testkit';
import { webGraphModel } from './graph-model.ts';

const graph: Graph = {
  nodes: [
    { laneId: 'L0', label: 'Coordinator lane', repositoryId: 'repo' },
    { laneId: 'L192', label: 'Worker lane', repositoryId: 'repo' },
    { laneId: 'L404', label: 'Lane without a session', repositoryId: null },
  ],
  edges: [
    { fromLane: 'L0', toLane: 'L192', kind: 'message', count: 8, lastAt: '2026-01-01T00:00:03Z' },
    { fromLane: 'L192', toLane: 'L0', kind: 'message', count: 2, lastAt: '2026-01-01T00:00:02Z' },
    { fromLane: 'L404', toLane: 'L0', kind: 'message', count: 1, lastAt: '2026-01-01T00:00:01Z' },
  ],
};

test('an unloaded graph never falls back to session-derived communication', () => {
  assert.deepEqual(webGraphModel({ graph: null, sessions: [] }), { lanes: [], sessions: [] });
});

test('lane-only canonical nodes retain direction, counts, thickness and unknown repository without session links', () => {
  const view = webGraphModel({ graph, sessions: [] });
  assert.equal(view.lanes.reduce((total, group) => total + group.edges.reduce((sum, edge) => sum + edge.count, 0), 0), 11);
  assert.deepEqual(view.lanes[0].edges.map(edge => [edge.from, edge.to, edge.count, edge.thickness]), [['L0', 'L192', 8, 3], ['L192', 'L0', 2, 2]]);
  assert.equal(view.lanes[1].title, 'Unassigned lanes');
  assert.ok(view.lanes.flatMap(group => group.nodes).every(node => node.sessionId === null && node.status === null));
  assert.deepEqual(view.sessions, []);
});

test('multiple sessions in one lane do not duplicate lane nodes; spawn links stay in their own section', () => {
  const base = generate().fixture.sessions[0] as unknown as Session;
  const sessions: Session[] = [
    { ...base, id: 'parent', laneId: 'L0', repositoryId: 'repo', role: 'orchestrator', parentSessionId: null, orchestratorSessionId: 'parent' },
    { ...base, id: 'child', laneId: 'L192', repositoryId: 'repo', role: 'subagent', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
    { ...base, id: 'sibling', laneId: 'L192', repositoryId: 'repo', role: 'subagent', parentSessionId: 'parent', orchestratorSessionId: 'parent' },
  ];
  const view = webGraphModel({ graph, sessions });
  assert.equal(view.lanes[0].nodes.length, 2);
  assert.equal(view.lanes[0].edges[0].count, 8);
  assert.deepEqual(view.sessions[0].edges.map(edge => [edge.kind, edge.from, edge.to]), [['spawn', 'parent', 'child'], ['spawn', 'parent', 'sibling']]);
  assert.deepEqual(view.sessions[0].nodes.map(node => node.sessionId), ['parent', 'child', 'sibling']);
});

test('time scrub is a last-activity cutoff, never a reconstruction of historical counts', () => {
  const view = webGraphModel({ graph, sessions: [] }, Date.parse('2026-01-01T00:00:02Z'));
  assert.deepEqual(view.lanes[0].edges.map(edge => [edge.from, edge.to, edge.count]), [['L192', 'L0', 2]]);
  assert.equal(view.lanes[1].edges[0].count, 1);
});

test('lane nodes carry the lane ID as label and the readable name separately; an unnamed lane has no name', () => {
  const view = webGraphModel({ graph, sessions: [] });
  assert.deepEqual(view.lanes[0].nodes.map(node => [node.label, node.name]), [['L0', 'Coordinator lane'], ['L192', 'Worker lane']]);
  const bare = webGraphModel({ graph: { nodes: [], edges: [{ fromLane: 'L7', toLane: 'L8', kind: 'message', count: 1, lastAt: '2026-01-01T00:00:01Z' }] }, sessions: [] });
  assert.deepEqual(bare.lanes[0].nodes.map(node => [node.label, node.name]), [['L7', null], ['L8', null]]);
});
