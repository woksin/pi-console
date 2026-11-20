import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadModels } from '../projections/index.ts';
import type { LaneModel } from '../projections/lanes.ts';
import type { MessageModel } from '../projections/messages.ts';
import { syntheticModels } from '../testing/synthetic-models.ts';
import { graphOf } from './graph.ts';

const lane = (id: string, over: Partial<LaneModel> = {}): LaneModel => ({
  id, name: `name-${id}`, repositoryId: 'repo', status: 'working', waitingOn: null, barredBy: null, parked: false, closed: false,
  registeredAt: '2026-01-01T00:00:00Z', statusAt: '2026-01-01T00:00:10Z', statusKey: 'k', issues: [], ...over,
});
const message = (id: string, from: string, to: string, sentAt: string): MessageModel => ({ id, from, to, text: 't', withheld: false, status: 'sent', sentAt });

function modelsOf(lanes: LaneModel[], messages: MessageModel[]): ReadModels {
  const models = syntheticModels({ sessions: 0, jobs: 0, messages: 0, requests: 0, questions: 0 });
  models.lanes.lanes = Object.fromEntries(lanes.map(entry => [entry.id, entry]));
  models.messages.messages = Object.fromEntries(messages.map(entry => [entry.id, entry]));
  return models;
}

test('message edges aggregate per direction, skip broadcasts and unsent, and create placeholder nodes', () => {
  const graph = graphOf(modelsOf([lane('a'), lane('b', { repositoryId: null })], [
    message('1', 'a', 'b', '2026-01-02'), message('2', 'a', 'b', '2026-01-03'), message('3', 'b', 'a', '2026-01-01'),
    message('4', 'a', '*', '2026-01-04'), message('5', 'a', 'b', ''), message('6', 'a', 'ghost', '2026-01-05'),
  ]));
  assert.deepEqual(graph.nodes.map(node => node.laneId), ['a', 'b', 'ghost']);
  assert.deepEqual(graph.nodes[2], { laneId: 'ghost', label: 'ghost', repositoryId: null });
  assert.deepEqual(graph.nodes[0], { laneId: 'a', label: 'name-a', repositoryId: 'repo' });
  assert.deepEqual(graph.edges, [
    { fromLane: 'a', toLane: 'b', kind: 'message', lastAt: '2026-01-03', count: 2 },
    { fromLane: 'a', toLane: 'ghost', kind: 'message', lastAt: '2026-01-05', count: 1 },
    { fromLane: 'b', toLane: 'a', kind: 'message', lastAt: '2026-01-01', count: 1 },
  ]);
});

test('waiting-on and barred-by edges come from open lanes naming a known lane', () => {
  const graph = graphOf(modelsOf([
    lane('a', { waitingOn: 'b', barredBy: 'c' }), lane('b'), lane('c'),
    lane('d', { waitingOn: 'a', closed: true }), lane('e', { waitingOn: 'a', statusAt: '' }), lane('f', { waitingOn: 'nowhere', barredBy: 'a' }),
  ], []));
  assert.deepEqual(graph.edges.map(edge => `${edge.kind}|${edge.fromLane}|${edge.toLane}`), ['barred-by|a|c', 'barred-by|f|a', 'waiting-on|a|b']);
  assert.equal(graph.edges[0].lastAt, '2026-01-01T00:00:10Z');
});
