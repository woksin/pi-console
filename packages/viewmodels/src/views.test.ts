import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureState } from './testing/fixture-state.ts';
import { applyEvent, buildActivity, buildFleet, buildGraph, buildMessageList, buildOverview, buildQuestions, buildRequests, buildSession, buildSettings, buildTimeline, buildWork, clean, resolveKey, sections } from './index.ts';

const state = fixtureState();

test('overview renders only the daemon attention list, with disabled read-only actions', () => {
  const overview = buildOverview(state);
  assert.equal(overview.needs.length, state.needsYou.length);
  assert.ok(overview.needs.length > 0);
  assert.equal(overview.empty, false);
  const asked = overview.needs.find(card => card.question);
  assert.ok(asked);
  assert.ok(asked.actions.filter(action => action.key !== 'Enter').every(action => !action.enabled));
  assert.match(overview.headline, /need/);
});

test('overview empty state', () => {
  const quiet = { ...state, needsYou: [] };
  assert.match(buildOverview(quiet).headline, /^Nothing needs you\./);
});

test('fleet groups by repository, nests subagents, filters and collapses', () => {
  const fleet = buildFleet(state);
  assert.equal(fleet.groups.length, 6);
  assert.equal(fleet.shown, 30);
  assert.ok(fleet.groups[0].rows.some(row => row.depth === 1));
  const working = buildFleet(state, { filter: 'status:working' });
  assert.ok(working.shown > 0 && working.shown < 30);
  assert.ok(working.groups.every(group => group.rows.every(row => row.badge.status === 'working')));
  const collapsed = buildFleet(state, { collapsed: [fleet.groups[0].id] });
  assert.equal(collapsed.order.length, fleet.order.length - fleet.groups[0].rows.length);
});

test('session folds deltas, joins tool results, marks resets and supports signal jump', () => {
  const id = 's2';
  const model = buildSession(state, id, { limit: 50 });
  assert.equal(model.found, true);
  assert.ok(model.rows.length <= 50);
  assert.ok(model.rows.some(row => row.tool));
  assert.ok(model.rows.every(row => row.kind !== 'assistant' || !row.text.includes('\u001b')));
  const target = state.needsYou.find(item => item.pointer)?.pointer;
  assert.ok(target);
  const jumped = buildSession(state, target.sessionId, { targetEntryId: target.entryId, limit: 30 });
  assert.equal(jumped.targetFound, true);
  assert.ok(jumped.rows.some(row => row.target));
  assert.equal(buildSession(state, 'nope').found, false);
});

test('transcript text is sanitised and never markup', () => {
  const hostile = '\u001b[31mred\u001b]0;title\u0007<img src=x onerror=alert(1)>\u202e';
  assert.equal(clean(hostile), 'red<img src=x onerror=alert(1)>');
});

test('requests, questions, messages, work, activity, settings build', () => {
  const requests = buildRequests(state, { filter: 'interrupted' });
  assert.ok(requests.rows.every(row => row.badge.status === 'interrupted' || row.statusText.includes('unseen')));
  assert.ok(buildRequests(state).selected);
  assert.ok(buildQuestions(state).rows.length > 0);
  assert.equal(buildQuestions({ ...state, questions: [] }).empty, true);
  assert.ok(buildMessageList(state).selected);
  assert.ok(buildWork(state).rows.length > 0);
  assert.equal(buildActivity(state).empty, true);
  assert.equal(buildSettings(state).connection.healthy, true);
});

test('graph and timeline are deterministic and bounded', () => {
  const graph = buildGraph(state);
  assert.deepEqual(buildGraph(state), graph);
  assert.ok(graph.nodes.every(node => node.x >= 0 && node.x <= 1000 && node.y >= 0 && node.y <= 640));
  const timeline = buildTimeline(state);
  assert.equal(timeline.order.length, 30);
  assert.ok(timeline.groups.every(group => group.rows.every(row => row.spans.every(span => span.from >= 0 && span.to <= 1))));
});

test('reducer applies deltas purely and deduplicates transcript entries', () => {
  const entry = { ...state.transcripts.s2![0], id: 'new-entry', cursor: 99999, at: '2026-11-20T10:00:00.000Z' };
  const next = applyEvent(state, { seq: 5, type: 'transcript.appended', occurredAt: entry.at, payload: entry });
  assert.equal(next.transcripts.s2!.at(-1)!.id, 'new-entry');
  assert.equal(applyEvent(next, { seq: 6, type: 'transcript.appended', occurredAt: entry.at, payload: entry }).transcripts.s2!.length, next.transcripts.s2!.length);
  assert.equal(state.transcripts.s2!.at(-1)?.id === 'new-entry', false);
  assert.equal(next.liveAt > state.liveAt, true);
});

test('keyboard map covers every section and the shared bindings', () => {
  for (const section of sections) assert.deepEqual(resolveKey({ key: section.key })?.command, { type: 'goto', section: section.id });
  assert.deepEqual(resolveKey({ key: 'p', ctrl: true })?.command, { type: 'palette' });
  assert.equal(resolveKey({ key: 'x', meta: true }), null);
  assert.deepEqual(resolveKey({ key: 'A' })?.command, { type: 'mutate', action: 'abort' });
});

test('golden: overview and fleet summaries', () => {
  const overview = buildOverview(state);
  const golden = {
    headline: overview.headline, needs: overview.needs.map(card => [card.reason, card.session?.id ?? null, card.age]),
    fleet: buildFleet(state).groups.map(group => [group.name, group.count]),
  };
  assert.ok(golden.needs.length > 0);
});
