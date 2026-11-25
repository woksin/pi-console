import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusCell } from '../format/status-cell.ts';
import { timelineGroups, withoutRepositoryPrefix } from './groups.ts';

const lane = (id: string) => ({ sessionId: id, label: id, status: statusCell('idle'), cells: [] });

test('repository groups keep first-seen order and stable lane order without changing lane data', () => {
  const lanes = ['a1', 'b1', 'a2'].map(lane);
  const sessions = [
    { id: 'a1', repositoryId: 'Alpha' }, { id: 'b1', repositoryId: 'Beta' }, { id: 'a2', repositoryId: 'Alpha' },
  ];
  const groups = timelineGroups(lanes, sessions);
  assert.deepEqual(groups.map(group => [group.repositoryId, group.lanes.map(item => item.sessionId)]), [
    ['Alpha', ['a1', 'a2']], ['Beta', ['b1']],
  ]);
  assert.equal(groups[0].lanes[0], lanes[0]);
  assert.equal(groups[0].lanes[1], lanes[2]);
  assert.deepEqual(lanes.map(item => item.sessionId), ['a1', 'b1', 'a2']);
});

test('empty input and unresolved lanes match the web grouping fallback', () => {
  assert.deepEqual(timelineGroups([], []), []);
  assert.equal(timelineGroups([lane('missing')], [])[0].repositoryId, 'Unknown repository');
});

test('only a leading repository prefix with a nonempty remainder is removed', () => {
  const labels = (name: string) => ({ name, lane: 'L1', title: 'unchanged' });
  for (const separator of [' ', '-', ':', '_', '·', '/']) {
    assert.deepEqual(withoutRepositoryPrefix(labels(`Aurora${separator}planner`), 'aurora'), labels('planner'));
  }
  for (const name of ['aurora', 'aurora-', 'aurorae planner', 'planner aurora']) {
    const original = labels(name);
    assert.equal(withoutRepositoryPrefix(original, 'aurora'), original);
  }
  assert.equal(withoutRepositoryPrefix(labels('x.y z'), 'x.y').name, 'z');
  assert.equal(withoutRepositoryPrefix(labels('xay z'), 'x.y').name, 'xay z');
  assert.equal(withoutRepositoryPrefix(labels('anything'), '').name, 'anything');
});
