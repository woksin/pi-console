import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchQuery, paletteItems, paletteView, rememberPick, segments } from './palette.ts';
import { fixture } from '../test-support.ts';

const { sessions, requests, questions, messages } = fixture;
const all = { sessions, requests, questions, messages };

test('empty query lists commands first', () => {
  assert.equal(paletteItems({ sessions, query: '' })[0].group, 'Command');
});

test('prefixes restrict the result kind', () => {
  assert.ok(paletteItems({ ...all, query: '>fleet' }).every(item => item.group === 'Command'));
  assert.ok(paletteItems({ ...all, query: '@review' }).every(item => item.group === 'Session' || item.group === 'Lane'));
  assert.ok(paletteItems({ ...all, query: '#retention' }).every(item => item.group === 'Question' || item.group === 'Request'));
  assert.ok(paletteItems({ ...all, query: '/' }).every(item => item.group === 'Message'));
  assert.equal(paletteView({ ...all, query: '#' }).scope, 'questions, requests');
});

test('fuzzy search finds a command and a session', () => {
  assert.equal(paletteItems({ sessions, query: 'timel' })[0].label, 'Go to Timeline');
  assert.ok(paletteItems({ sessions, query: 'scout' }).some(item => item.group === 'Session'));
});

test('"aur" ranks only aurora results first', () => {
  const items = paletteItems({ ...all, query: 'aur' });
  const firstOther = items.findIndex(item => !`${item.label} ${item.detail}`.toLowerCase().includes('aur'));
  const lastAurora = items.map(item => `${item.label} ${item.detail}`.toLowerCase().includes('aur')).lastIndexOf(true);
  assert.ok(items.length > 0);
  assert.ok(firstOther === -1 || firstOther > lastAurora, 'an aurora match ranks after a non-aurora one');
  assert.ok(items.slice(0, 3).every(item => item.label.toLowerCase().startsWith('aur')));
});

test('ranking prefers a prefix, then a word start, then a substring, then a subsequence', () => {
  const rank = (label: string): number | undefined => matchQuery('aur', label)?.rank;
  assert.deepEqual([rank('aurora main'), rank('the aurora lane'), rank('dinosaurs'), rank('a quiet ruse')], [0, 1, 2, 5.009]);
  assert.equal(rank('quartz'), undefined);
  assert.equal(matchQuery('aur main', 'aurora main')?.rank, 1);
  assert.equal(matchQuery('aur', 'quartz', 'aurora/L192')?.rank, 3);
});

test('match ranges become highlighted segments', () => {
  const match = matchQuery('aur impl', 'aurora implementation');
  assert.deepEqual(segments('aurora implementation', match?.ranges ?? []), [
    { text: 'aur', hit: true }, { text: 'ora ', hit: false }, { text: 'impl', hit: true }, { text: 'ementation', hit: false },
  ]);
  const [first] = paletteItems({ sessions, query: 'aur' });
  assert.deepEqual(first.segments[0], { text: 'aur', hit: true });
});

test('every result carries a status glyph, a colour token and a label; groups are contiguous', () => {
  const view = paletteView({ ...all, query: 'a' });
  assert.ok(view.items.every(item => item.glyph.length > 0 && item.tone.length > 0 && item.status.length > 0));
  assert.deepEqual(view.items, view.sections.flatMap(section => section.items));
  assert.equal(new Set(view.sections.map(section => section.title)).size, view.sections.length);
  assert.ok(view.shown <= 14);
});

test('lanes roll up to their most urgent session and open a top-level session', () => {
  const lane = paletteItems({ sessions, query: '@aurora/L192' }).find(item => item.group === 'Lane');
  assert.ok(lane);
  const members = sessions.filter(session => session.repositoryId === 'aurora' && session.laneId === 'L192');
  if (members.some(session => session.status === 'needs-you')) assert.equal(lane.status, 'Needs you');
  assert.equal(lane.target.kind, 'session');
  if (lane.target.kind === 'session') assert.notEqual(sessions.find(session => session.id === (lane.target as { sessionId: string }).sessionId)?.role, 'subagent');
});

test('recents come first on an empty query and break ties in a search', () => {
  const pick = paletteItems({ sessions, query: '@' })[3];
  const view = paletteView({ sessions, query: '', recents: [pick.id] });
  assert.equal(view.sections[0].title, 'Recent');
  assert.equal(view.items[0].id, pick.id);
  assert.equal(view.items.filter(item => item.id === pick.id).length, 1);
  assert.deepEqual(rememberPick(['a', 'b'], 'b'), ['b', 'a']);
});

test('the web palette never offers the TUI-only quit command', () => {
  assert.ok(!paletteItems({ sessions, query: '>quit', client: 'web' }).some(item => item.label === 'Quit'));
  assert.ok(paletteItems({ sessions, query: '>quit', client: 'tui' }).some(item => item.label === 'Quit'));
});
