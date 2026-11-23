import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import { repositoryLabel, sessionLabels } from './session-labels.ts';
import { fleetViewModel } from '../fleet/fleet.ts';
import { overviewViewModel } from '../overview/overview.ts';
import { timelineViewModel } from '../timeline/timeline.ts';
import { graphViewModel } from '../graph/graph.ts';
import { sessionViewModel } from '../session/session.ts';

const session: Session = {
  id: 'abcdef01-1234', repositoryId: '/work/console', name: 'console', laneId: 'unassigned', branch: '', cwd: '/work/console',
  role: 'main', parentSessionId: null, orchestratorSessionId: 'abcdef01-1234', model: '', status: 'idle',
  startedAt: '2026-07-01T09:00:00Z', updatedAt: '2026-07-01T09:00:00Z', contextPercent: 0, samples: [],
};

test('readable labels preserve real one-word names and distinguish same-cwd sessions before clipping', () => {
  const first = sessionLabels(session);
  const second = sessionLabels({ ...session, id: 'fedcba98-1234' });
  assert.equal(first.name, 'abcdef01 console');
  assert.equal(first.lane, '');
  assert.equal(first.branch, '');
  assert.notEqual(first.timeline, second.timeline);
  assert.equal(sessionLabels({ ...session, name: 'review' }).name, 'review');
  assert.equal(sessionLabels({ ...session, name: '' }).name, first.name);
  assert.equal(sessionLabels({ ...session, name: '\u001b[31mreview\u001b[0m' }).name, 'review');
  for (const path of ['/work/console/', 'C:\\work\\console\\', 'console']) assert.equal(repositoryLabel(path), 'console');
  const rich = sessionLabels({ ...session, repositoryId: 'aurora', laneId: 'L1', branch: 'feature', name: 'aurora worker' });
  assert.equal(rich.attention, 'aurora/L1');
  assert.equal(rich.title, 'aurora / L1 / aurora worker');
  assert.equal(rich.timeline, 'L1 worker');
  assert.equal(rich.graph, 'L1 main');
  assert.equal(sessionLabels({ ...session, laneId: 'L1', name: 'review' }).timeline, 'L1 review');
});

test('all five viewmodels display real identity while preserving raw grouping keys', () => {
  const child = { ...session, id: 'fedcba98-1234', parentSessionId: session.id, role: 'subagent' as const };
  const sessions = [session, child];
  const fleet = fleetViewModel({ sessions, now: Date.parse(session.updatedAt) });
  assert.equal(fleet.rows[0].id, session.repositoryId);
  assert.equal(fleet.rows[0].kind === 'group' && fleet.rows[0].label, 'console');
  assert.equal(fleet.rows[1].kind === 'session' && fleet.rows[1].cost, '—');
  const overview = overviewViewModel({ sessions, repositories: 1, now: Date.parse(session.updatedAt), needsYou: [{ id: 's', sessionId: session.id, laneId: null, reason: 'stale-session', text: '', since: session.updatedAt, pointer: null }] });
  assert.equal(overview.cards[0].title, 'abcdef01 console');
  const resets = sessions.map(row => ({ id: `${row.id}-reset`, sessionId: row.id, at: row.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
  const timeline = timelineViewModel({ sessions, requests: [], questions: [], messages: [], resets, width: 80 });
  assert.deepEqual(timeline.lanes.map(lane => lane.label), ['abcdef01 console', 'fedcba98 console']);
  const graph = graphViewModel({ sessions, messages: [] });
  assert.equal(graph.groups[0].repositoryId, session.repositoryId);
  assert.equal(graph.groups[0].nodes[0].label, 'abcdef01 console main');
  const detail = { session, requests: [], questions: [], jobs: [], resets: [], subagents: [child] };
  const view = sessionViewModel({ detail, transcript: [], now: Date.parse(session.updatedAt) });
  assert.equal(view.title, 'abcdef01 console');
  assert.equal(view.subagents[0].name, 'fedcba98 console');
});
