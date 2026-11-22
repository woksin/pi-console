import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate } from '../fixture/generate.ts';
import { graph } from './v1-extras.ts';

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
