import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate } from '../fixture/generate.ts';
import { graph } from './v1-extras.ts';

test('default mock graph has one group per repository, with every lane in its sessions\' repository', () => {
  const { fixture } = generate();
  const result = graph(fixture);
  const repositories = new Set(result.nodes.map(node => node.repositoryId));
  assert.deepEqual([...repositories].sort(), fixture.repositories.map(repository => repository.id));
  assert.equal(result.nodes.length, 30);
  for (const session of fixture.sessions) {
    const node = result.nodes.find(candidate => candidate.laneId === session.laneId);
    assert.equal(node?.repositoryId, session.repositoryId, `${session.id} agrees with the timeline's repository`);
    assert.equal(node.label, session.name);
  }
});

test('mock graph keeps all 40 messages, split 8/8/8/8/4/4 across repositories, with directions and dependency kinds', () => {
  const { fixture } = generate();
  const result = graph(fixture);
  const repositoryOf = new Map(result.nodes.map(node => [node.laneId, node.repositoryId]));
  const lanes = new Map(fixture.sessions.map(session => [session.id, session.laneId]));
  const totals = new Map<string | null, number>();
  for (const edge of result.edges.filter(candidate => candidate.kind === 'message')) {
    const repository = repositoryOf.get(edge.fromLane) ?? null;
    assert.equal(repositoryOf.get(edge.toLane), repository, 'a message stays inside one repository');
    totals.set(repository, (totals.get(repository) ?? 0) + edge.count);
  }
  assert.deepEqual([...totals.values()].sort((a, b) => b - a), [8, 8, 8, 8, 4, 4]);
  for (const message of fixture.messages) {
    const from = lanes.get(message.fromSessionId);
    const to = lanes.get(message.toSessionId);
    assert.ok(result.edges.some(edge => edge.kind === 'message' && edge.fromLane === from && edge.toLane === to), message.id);
  }
  assert.deepEqual(new Set(result.edges.map(edge => edge.kind)), new Set(['message', 'waiting-on', 'barred-by']));
});

test('sessions sharing a lane label it from the first session in fixture order', () => {
  const { fixture } = generate();
  const [first, second] = fixture.sessions;
  fixture.sessions = [first, { ...second, laneId: first.laneId }];
  fixture.messages = [];
  assert.deepEqual(graph(fixture).nodes, [{ laneId: first.laneId, label: first.name, repositoryId: first.repositoryId }]);
});
