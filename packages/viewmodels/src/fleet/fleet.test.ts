import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetEntryKey, fleetRowAt, fleetStructure, fleetViewModel } from './fleet.ts';
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

test('the filter matches the displayed fallback name as well as the raw name and id', () => {
  const session = { ...fixture.sessions[0], id: 'abcdef01-1234', name: '/work/repo', repositoryId: '/work/repo', cwd: '/work/repo', laneId: 'unassigned', parentSessionId: null };
  const sessions = [session, { ...session, id: 'other-session-id', name: 'Different' }];
  const model = fleetViewModel({ sessions, now });
  const row = model.rows.find(row => row.kind === 'session' && row.id === session.id);
  assert.ok(row?.kind === 'session');
  assert.equal(row.name, 'abcdef01 repo');
  for (const query of [row.name, session.name, session.id]) {
    const filtered = fleetViewModel({ sessions: [session], now, query });
    assert.equal(filtered.matched, 1, query);
    assert.ok(filtered.rows.some(row => row.kind === 'session' && row.id === session.id), query);
  }
  assert.equal(fleetViewModel({ sessions, now, query: row.name }).matched, 1);
  assert.equal(fleetViewModel({ sessions, now, query: 'absent label' }).matched, 0);
});

test('the clock-free structure formats the same rows for any clock and matches the wrapper', () => {
  const input = { sessions: fixture.sessions, collapsed: new Set(['aurora']), query: '' };
  const structure = fleetStructure(input);
  assert.deepEqual(structure.entries.map(entry => fleetRowAt(entry, now)), fleetViewModel({ ...input, now }).rows);
  assert.deepEqual(structure.keys, structure.entries.map(fleetEntryKey));
  const later = structure.entries.map(entry => fleetRowAt(entry, now + 3_600_000));
  assert.deepEqual(later.map(row => row.id), structure.entries.map(entry => entry.id), 'order and ids do not depend on the clock');
  assert.ok(later.some((row, index) => row.kind === 'session' && row.age !== (fleetRowAt(structure.entries[index], now) as typeof row).age));
});

test('a 30k-session structure keeps group counts and selection keys without formatting any session', () => {
  const template = fixture.sessions[0];
  const sessions = Array.from({ length: 30_000 }, (_, index) => ({ ...template, id: `bulk-${String(index)}`, parentSessionId: null, repositoryId: `repo-${String(index % 3)}` }));
  const structure = fleetStructure({ sessions });
  assert.equal(structure.entries.length, 30_003);
  assert.equal(structure.keys.length, 30_003);
  assert.equal(structure.entries.filter(entry => entry.kind === 'group').reduce((sum, entry) => sum + entry.sessions, 0), 30_000);
  assert.equal(fleetStructure({ sessions, collapsed: new Set(['repo-0']) }).entries.length, 20_003);
});
