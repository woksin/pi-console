import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphViewModel } from './graph.ts';
import { fixture, golden } from '../test-support.ts';

test('graph aggregates messages per pair and adds spawn edges, grouped by repository', () => {
  const model = graphViewModel({ sessions: fixture.sessions, messages: fixture.messages });
  assert.ok(model.groups.length > 0);
  const total = model.groups.reduce((sum, group) => sum + group.messages, 0);
  assert.equal(total, fixture.messages.length);
  assert.ok(model.groups.some(group => group.edges.some(edge => edge.kind === 'spawn')));
  for (const group of model.groups) for (const edge of group.edges) assert.ok(group.nodes.some(node => node.sessionId === edge.from));
  golden('graph', model);
});
