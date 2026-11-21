import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusCell } from '@pi-console/viewmodels';
import { groupHeight, laneHeight, timelineGroups } from './timeline-groups.ts';

const lane = (id: string) => ({ sessionId: id, label: id, status: statusCell('idle'), cells: [] });

test('timeline groups interleaved lanes by repository with room for each header', () => {
  const lanes = ['a1', 'b1', 'a2'].map(lane);
  const sessions = [
    { id: 'a1', repositoryId: 'Alpha' }, { id: 'b1', repositoryId: 'Beta' }, { id: 'a2', repositoryId: 'Alpha' },
  ];
  const groups = timelineGroups(lanes, sessions);
  assert.deepEqual(groups.map(group => [group.repositoryId, group.lanes.map(item => item.sessionId)]), [
    ['Alpha', ['a1', 'a2']], ['Beta', ['b1']],
  ]);
  assert.deepEqual(groups.map(group => group.top), [30, 30 + groupHeight + 2 * laneHeight]);
  assert.equal(groups[0].lanes[0], lanes[0], 'markers and status are not recomputed');
});

test('timeline grouping handles empty input and never drops an unresolved lane', () => {
  assert.deepEqual(timelineGroups([], []), []);
  assert.equal(timelineGroups([lane('missing')], [])[0].repositoryId, 'Unknown repository');
});
