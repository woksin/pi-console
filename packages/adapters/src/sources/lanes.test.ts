import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneMapper, rosterMapper } from './lanes.ts';

test('registry metadata is allowlisted and roster/old records cannot erase it', () => {
  const mapped = laneMapper({ version: 1, lanes: [{ id: 'L1', repo: 'repo', cwd: '/work/repo', branch: 'feature', prompt: 'private', sessionId: 'not-proof' }] });
  assert.deepEqual(mapped[0].payload, { laneId: 'L1', name: 'L1', repositoryId: 'repo', cwd: '/work/repo', branch: 'feature' });
  assert.deepEqual(laneMapper({ version: 1, lanes: [{ id: 'L1', repo: 'repo' }] })[0].payload, { laneId: 'L1', name: 'L1', repositoryId: 'repo' });
  assert.deepEqual(laneMapper({ version: 1, lanes: [{ id: 'L1', cwd: null, branch: null }] })[0].payload, { laneId: 'L1', name: 'L1', repositoryId: null, cwd: null, branch: null });
  const roster = rosterMapper({ id: 'L1', cwd: '/work/repo', startedAt: '2026-07-01T09:00:00Z', branch: 'not-proof' });
  assert.deepEqual(roster[0].payload, { laneId: 'L1', name: 'L1', repositoryId: null });
});
