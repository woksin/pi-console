import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeBindings } from '@pi-console/viewmodels';
import { commit, contextOf, handleKey, initial, reduce, typing, type Bounds } from './ui.ts';
import type { TranscriptLayout } from './transcript-window.ts';
import { neutralKey, typedCharacter } from './keys.ts';

const layoutOfHeights = (heights: number[], first = 1): TranscriptLayout => { let end = 0; return { keys: heights.map((_, index) => first + index), ends: heights.map(height => (end += height)) }; };
const bounds: Bounds = { length: 5, page: 3, fit: { start: 0, span: 1000 }, width: 80, rowAt: index => ({ sessionId: `s${String(index)}`, groupId: index === 0 ? 'g' : null }), transcript: layoutOfHeights(Array.from({ length: 50 }, () => 1)), viewport: 10 };

test('number keys switch sections and the cursor stays within the list', () => {
  const fleet = handleKey(initial, '2', bounds);
  assert.equal(fleet.section, 'fleet');
  const down = handleKey(handleKey(fleet, 'j', bounds), 'j', bounds);
  assert.equal(down.cursor.fleet, 2);
  assert.equal(reduce({ ...fleet, cursor: { ...fleet.cursor, fleet: 4 } }, 'move.down', bounds).cursor.fleet, 4);
  assert.equal(reduce(fleet, 'move.up', bounds).cursor.fleet, 0);
  assert.equal(reduce(fleet, 'move.bottom', bounds).cursor.fleet, 4);
});

test('open and back move between a list and a session', () => {
  const opened = reduce({ ...initial, section: 'fleet', cursor: { ...initial.cursor, fleet: 2 } }, 'open', bounds);
  assert.equal(opened.sessionId, 's2');
  assert.equal(contextOf(opened), 'transcript');
  assert.equal(reduce(opened, 'back', bounds).sessionId, null);
});

test('f toggles follow and scrolling away pauses it', () => {
  const session = { ...initial, sessionId: 's1' };
  const paused = reduce(session, 'follow.toggle', bounds);
  assert.equal(paused.follow, false);
  assert.equal(reduce(paused, 'follow.toggle', bounds).follow, true);
});

test('groups fold and unfold from the fleet', () => {
  const fleet = { ...initial, section: 'fleet' as const };
  const folded = reduce(fleet, 'group.toggle', bounds);
  assert.deepEqual(folded.collapsed, ['g']);
  assert.deepEqual(reduce(folded, 'group.toggle', bounds).collapsed, []);
});

test('typing builds the filter, backspace edits it and enter commits it', () => {
  const open = reduce({ ...initial, section: 'fleet' }, 'filter.open', bounds);
  assert.equal(open.overlay, 'filter');
  const typed = typing(typing(typing(open, 'x', 'a'), 'x', 'b'), 'Backspace', undefined);
  assert.equal(typed.input, 'a');
  const done = commit(typed);
  assert.equal(done.filter, 'a');
  assert.equal(done.overlay, 'none');
});

test('escape closes overlays before it leaves a view', () => {
  const palette = reduce(initial, 'palette.open', bounds);
  assert.equal(reduce(palette, 'back', bounds).overlay, 'none');
});

test('quit sets the flag and nothing else', () => {
  assert.equal(handleKey(initial, 'q', bounds).quit, true);
});

test('every binding in the shared keymap resolves to a reducer action without throwing', () => {
  for (const binding of activeBindings) {
    for (const key of binding.keys) assert.doesNotThrow(() => handleKey(initial, key, bounds), `${binding.label}: ${key}`);
  }
});

test('terminal keys translate to the neutral names of the keymap', () => {
  const key = (name: string, sequence: string, extra: { ctrl?: boolean; shift?: boolean } = {}) => ({ name, sequence, ctrl: false, meta: false, shift: false, ...extra });
  assert.equal(neutralKey(key('return', '\r')), 'Enter');
  assert.equal(neutralKey(key('escape', '\u001b')), 'Esc');
  assert.equal(neutralKey(key('p', '\u0010', { ctrl: true })), 'Ctrl+P');
  assert.equal(neutralKey(key('tab', '\t', { shift: true })), 'Shift+Tab');
  assert.equal(neutralKey(key('j', 'j')), 'j');
  assert.equal(typedCharacter(key('a', 'a')), 'a');
  assert.equal(typedCharacter(key('p', '\u0010', { ctrl: true })), undefined);
});

test('pausing follow stores a stable entry position, and scrolling to the live bottom resumes it', () => {
  const session = { ...initial, sessionId: 's1' };
  const paused = reduce(session, 'follow.toggle', bounds);
  assert.deepEqual(paused.anchor, { key: 41, offset: 0, limit: 50 });
  assert.equal(reduce(paused, 'follow.toggle', bounds).anchor, null);
  const scrolled = reduce(session, 'move.up', bounds);
  assert.deepEqual(scrolled.anchor, { key: 40, offset: 0, limit: 50 });
  const grown = { ...bounds, transcript: layoutOfHeights(Array.from({ length: 60 }, () => 1)) };
  assert.equal(reduce(scrolled, 'move.up', grown).anchor?.key, 39, 'growth does not move the anchor');
  assert.equal(reduce(scrolled, 'move.down', grown).anchor?.key, 41, 'scrolling down stops at the pause point');
  assert.equal(reduce(scrolled, 'move.bottom', bounds).anchor, null);
  assert.equal(reduce(session, 'move.top', bounds).anchor?.key, 1);
});

test('on Requests the shared filter keys cycle state, origin and session and reset the cursor; elsewhere they do nothing', () => {
  const requests = { ...initial, section: 'requests' as const, cursor: { ...initial.cursor, requests: 3 } };
  const withSessions = { ...bounds, sessionIds: ['s1', 's2'] };
  const next = handleKey(requests, ']', withSessions);
  assert.deepEqual([next.requestFilter.state, next.cursor.requests], ['open', 0]);
  assert.equal(handleKey(next, '[', withSessions).requestFilter.state, 'all');
  assert.equal(handleKey(requests, 'o', withSessions).requestFilter.origin, 'human');
  assert.equal(handleKey(requests, 'S', withSessions).requestFilter.sessionId, 's1');
  assert.deepEqual(handleKey({ ...initial, section: 'fleet' }, ']', withSessions).requestFilter, initial.requestFilter);
});

test('opening a request carries its transcript entry; going back or switching section drops it', () => {
  const pointed: Bounds = { ...bounds, rowAt: () => ({ sessionId: 's2', groupId: null, entryId: 'entry9' }) };
  const opened = reduce({ ...initial, section: 'requests' }, 'open', pointed);
  assert.deepEqual([opened.sessionId, opened.focusEntry], ['s2', 'entry9']);
  assert.equal(reduce(opened, 'back', pointed).focusEntry, null);
  assert.equal(reduce(opened, 'section.2', pointed).focusEntry, null);
  assert.equal(reduce({ ...initial, section: 'fleet' }, 'open', bounds).focusEntry, null);
});
