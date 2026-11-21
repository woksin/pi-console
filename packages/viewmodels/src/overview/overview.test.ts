import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionSections, overviewViewModel } from './overview.ts';
import { attention, fixture, golden, now } from '../test-support.ts';

const model = overviewViewModel({ needsYou: attention, sessions: fixture.sessions, repositories: fixture.repositories.length, now });

test('overview renders the daemon needs-you list unchanged and in order', () => {
  assert.deepEqual(model.cards.map(card => card.id), attention.map(item => item.id));
  assert.ok(model.cards.every(card => card.reasonLabel && card.status.label));
  assert.match(model.headline, /need/);
  golden('overview', model);
});

test('counts cover all seven statuses and sum to the fleet', () => {
  assert.equal(model.counts.reduce((sum, entry) => sum + entry.count, 0), fixture.sessions.length);
  assert.equal(model.fleet.contextSeries.length, 24);
});

test('attention sections preserve daemon rank and every card', () => {
  const sections = attentionSections(model.cards);
  assert.deepEqual(sections.flatMap(section => section.cards), model.cards);
  assert.ok(sections.every(section => section.label && section.cards.length > 0));
});

test('request A, question B, request C keep daemon rank in adjacent-only attention sections', () => {
  const needsYou = [
    { ...attention[0], id: 'request A', reason: 'open-request' as const, since: '2026-11-20T09:00:00Z' },
    { ...attention[0], id: 'question B', reason: 'blocking-question' as const, since: '2026-11-20T10:00:00Z' },
    { ...attention[0], id: 'request C', reason: 'open-request' as const, since: '2026-11-20T11:00:00Z' },
  ];
  const view = overviewViewModel({ needsYou, sessions: fixture.sessions, repositories: fixture.repositories.length, now });
  const sections = attentionSections(view.cards);
  assert.deepEqual(sections.map(section => section.label), ['Open request', 'Blocking question', 'Open request']);
  assert.deepEqual(sections.map(section => section.cards.map(card => card.id)), [['request A'], ['question B'], ['request C']]);
  assert.deepEqual(sections.flatMap(section => section.cards), view.cards);
});

test('first run uses the information architecture wording instead of declaring all clear', () => {
  assert.equal(overviewViewModel({ needsYou: [], sessions: [], repositories: 0, now }).headline, 'No pi sessions found yet.');
});

test('empty needs-you with sessions reads as all clear', () => {
  assert.equal(overviewViewModel({ needsYou: [], sessions: fixture.sessions, repositories: fixture.repositories.length, now }).headline, 'All clear: nothing needs you');
});
