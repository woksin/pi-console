import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetViewModel } from './fleet.ts';
import { fixture, golden, now } from '../test-support.ts';

test('fleet groups by repository with subagents under their parent', () => {
  const model = fleetViewModel({ sessions: fixture.sessions, now });
  const groups = model.rows.filter(row => row.kind === 'group');
  assert.equal(groups.length, fixture.repositories.length);
  const rows = model.rows.filter(row => row.kind === 'session');
  const s4 = rows.findIndex(row => row.id === 's4');
  assert.equal(rows[s4].depth, 1);
  assert.equal(rows[s4 - 1].id === 's2' || rows[s4 - 1].depth === 1, true);
  golden('fleet', model);
});

test('collapsing hides a group and the query filters with fuzzy match', () => {
  const collapsed = fleetViewModel({ sessions: fixture.sessions, now, collapsed: new Set(['aurora']) });
  assert.ok(!collapsed.rows.some(row => row.kind === 'session' && row.id === 's1'));
  const filtered = fleetViewModel({ sessions: fixture.sessions, now, query: 'review' });
  assert.ok(filtered.matched < fixture.sessions.length);
  assert.ok(filtered.rows.some(row => row.kind === 'session' && row.name.includes('review')));
});
