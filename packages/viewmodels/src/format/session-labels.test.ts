import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import { fitSessionLabel, repositoryLabel, sessionLabels } from './session-labels.ts';
import { displayWidth, graphemes } from './format.ts';
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

const variants = ['attention', 'timeline', 'graph', 'title'] as const;

test('fitting preserves the complete lane and clips only the readable name', () => {
  const label = { name: 'aurora implementation', lane: 'L192' };
  assert.equal(fitSessionLabel(label, 40), 'aurora implementation · L192');
  assert.equal(fitSessionLabel(label, 14), 'aurora… · L192');
  assert.equal(fitSessionLabel(label, 8), '… · L192');
  for (const width of [-1, 0, 1, 4, 7]) assert.equal(fitSessionLabel(label, width), 'L192');
  assert.equal(fitSessionLabel({ name: 'L192', lane: 'L192' }, 1), 'L192');
  assert.equal(fitSessionLabel({ name: '', lane: 'L192' }, 1), 'L192');
  assert.equal(fitSessionLabel({ name: 'aurora', lane: '' }, 4), 'aur…');
  assert.equal(fitSessionLabel({ name: 'aurora', lane: '' }, 0), '');
});

test('fitting counts wide graphemes and supports the renderer cell measurement', () => {
  for (const name of ['界界界review', '👩‍💻👩‍💻👩‍💻review']) {
    const fitted = fitSessionLabel({ name, lane: 'L192' }, 12);
    assert.equal(displayWidth(fitted), 12);
    assert.match(fitted, /… · L192$/);
  }
  assert.equal(fitSessionLabel({ name: '界界界review', lane: 'L192' }, 12), '界界… · L192');
  assert.equal(fitSessionLabel({ name: '界界界review', lane: 'L192' }, 10, text => graphemes(text).length), '界界… · L192');
});

test('one identity keeps the readable name first and lane secondary in every single-string variant', () => {
  const labels = sessionLabels({ ...session, name: ' aurora scout ', repositoryId: 'aurora', laneId: ' L195 ', branch: 'lane-195' });
  assert.equal(labels.repository, 'aurora');
  assert.equal(labels.lane, 'L195');
  assert.equal(labels.name, 'aurora scout');
  assert.equal(labels.branch, 'lane-195');
  for (const variant of variants) assert.equal(labels[variant], 'aurora scout · L195');
});

test('missing identities fall back to lane, name, then short id without repeating the lane', () => {
  for (const [name, laneId, expected] of [
    ['', 'L195', 'L195'], ['review', '', 'review'], ['review', 'unassigned', 'review'],
    ['', '', 'abcdef01'], ['', 'unassigned', 'abcdef01'], [session.id, 'unassigned', 'abcdef01'],
    ['L195', 'L195', 'L195'], ['   ', ' L195 ', 'L195'],
  ]) {
    const labels = sessionLabels({ ...session, name, laneId });
    assert.equal(labels.name, expected);
    for (const variant of variants) assert.equal(labels[variant], expected);
  }
});

test('callers with only id and name still get a readable, sanitized identity', () => {
  assert.equal(sessionLabels({ id: session.id, name: 'review' }).title, 'review');
  assert.equal(sessionLabels({ id: session.id, name: '' }).title, 'abcdef01');
});

test('real one-word names survive sanitizing and same-cwd sessions stay distinct before clipping', () => {
  const first = sessionLabels(session);
  const second = sessionLabels({ ...session, id: 'fedcba98-1234' });
  assert.equal(first.name, 'abcdef01');
  assert.equal(first.lane, '');
  assert.equal(first.branch, '');
  assert.notEqual(first.timeline, second.timeline);
  assert.equal(sessionLabels({ ...session, name: 'review' }).name, 'review');
  assert.equal(sessionLabels({ ...session, name: '' }).name, first.name);
  assert.equal(sessionLabels({ ...session, name: '\u001b[31mreview\u001b[0m' }).name, 'review');
  assert.equal(sessionLabels({ ...session, name: session.cwd }).name, first.name);
  for (const path of ['/work/console/', 'C:\\work\\console\\', 'console']) assert.equal(repositoryLabel(path), 'console');
});

test('all five viewmodels display real identity while preserving raw grouping keys', () => {
  const child = { ...session, id: 'fedcba98-1234', parentSessionId: session.id, role: 'subagent' as const };
  const sessions = [session, child];
  const fleet = fleetViewModel({ sessions, now: Date.parse(session.updatedAt) });
  assert.equal(fleet.rows[0].id, session.repositoryId);
  assert.equal(fleet.rows[0].kind === 'group' && fleet.rows[0].label, 'console');
  assert.equal(fleet.rows[1].kind === 'session' && fleet.rows[1].cost, '—');
  const overview = overviewViewModel({ sessions, repositories: 1, now: Date.parse(session.updatedAt), needsYou: [{ id: 's', sessionId: session.id, laneId: null, reason: 'stale-session', text: '', since: session.updatedAt, pointer: null }] });
  assert.equal(overview.cards[0].title, 'abcdef01');
  const resets = sessions.map(row => ({ id: `${row.id}-reset`, sessionId: row.id, at: row.startedAt, kind: 'compaction' as const, carriedRequestIds: [], interruptedRequestIds: [] }));
  const timeline = timelineViewModel({ sessions, requests: [], questions: [], messages: [], resets, width: 80 });
  assert.deepEqual(timeline.lanes.map(lane => lane.label), ['abcdef01', 'fedcba98']);
  const graph = graphViewModel({ sessions, messages: [] });
  assert.equal(graph.groups[0].repositoryId, session.repositoryId);
  assert.equal(graph.groups[0].nodes[0].label, 'abcdef01');
  const detail = { session, requests: [], questions: [], jobs: [], resets: [], subagents: [child] };
  const view = sessionViewModel({ detail, transcript: [], now: Date.parse(session.updatedAt) });
  assert.equal(view.title, 'abcdef01');
  assert.equal(view.subagents[0].name, 'fedcba98');
});
