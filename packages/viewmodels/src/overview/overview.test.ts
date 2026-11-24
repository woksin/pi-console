import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionSections, overviewViewModel } from './overview.ts';
import { attention, fixture, golden, now } from '../test-support.ts';

const model = overviewViewModel({ needsYou: attention, sessions: fixture.sessions, repositories: fixture.repositories.length, now });

test('overview keeps every attention card exactly once in reason-priority order', () => {
  assert.deepEqual(model.cards.map(card => card.id).sort(), attention.map(item => item.id).sort());
  assert.ok(model.cards.every(card => card.reasonLabel && card.status.label));
  assert.match(model.headline, /need/);
  golden('overview', model);
});

test('counts cover all seven statuses and sum to the fleet', () => {
  assert.equal(model.counts.reduce((sum, entry) => sum + entry.count, 0), fixture.sessions.length);
  assert.equal(model.fleet.contextSeries.length, 24);
});

test('attention sections preserve shared viewmodel order and contain one heading per reason', () => {
  const sections = attentionSections(model.cards);
  assert.deepEqual(sections.flatMap(section => section.cards), model.cards);
  assert.ok(sections.every(section => section.label && section.cards.length > 0));
  assert.equal(new Set(sections.map(section => section.label)).size, sections.length);
});

test('interleaved reasons form one section each, with newest cards first inside each reason', () => {
  const needsYou = [
    { ...attention[0], id: 'request A', reason: 'open-request' as const, since: '2026-11-20T09:00:00Z' },
    { ...attention[0], id: 'question B', reason: 'blocking-question' as const, since: '2026-11-20T10:00:00Z' },
    { ...attention[0], id: 'request C', reason: 'open-request' as const, since: '2026-11-20T11:00:00Z' },
  ];
  const view = overviewViewModel({ needsYou, sessions: fixture.sessions, repositories: fixture.repositories.length, now });
  const sections = attentionSections(view.cards);
  assert.deepEqual(sections.map(section => section.label), ['Blocking question', 'Open requests']);
  assert.deepEqual(sections.map(section => section.cards.map(card => card.id)), [['question B'], ['request C', 'request A']]);
  assert.deepEqual(needsYou.map(item => item.id), ['request A', 'question B', 'request C'], 'input remains unchanged');
  assert.deepEqual(sections.flatMap(section => section.cards), view.cards);
});

test('all reasons have a fixed priority and possibly unseen has its own matching chip', () => {
  const reasons = ['stale-session', 'proposed-memory', 'lane-waiting-on-user', 'answer-possibly-unseen', 'open-request', 'blocking-question'] as const;
  const needsYou = reasons.map((reason, index) => ({ ...attention[0], id: String(index), reason }));
  const view = overviewViewModel({ needsYou, sessions: fixture.sessions, repositories: fixture.repositories.length, now });
  assert.deepEqual(view.cards.map(card => card.reason), reasons.toReversed());
  const unseen = view.cards.find(card => card.reason === 'answer-possibly-unseen');
  assert.equal(unseen?.status.status, 'answer-possibly-unseen');
  assert.equal(unseen?.status.glyph, '¿');
  assert.equal(unseen?.status.label, unseen?.reasonLabel);
});

test('first run uses the information architecture wording instead of declaring all clear', () => {
  assert.equal(overviewViewModel({ needsYou: [], sessions: [], repositories: 0, now }).headline, 'No pi sessions found yet.');
});

test('empty needs-you with sessions reads as all clear', () => {
  assert.equal(overviewViewModel({ needsYou: [], sessions: fixture.sessions, repositories: fixture.repositories.length, now }).headline, 'All clear: nothing needs you');
});

test('section headings are plural unless the count is exactly one', () => {
  const card = (reason: string, reasonLabel: string) => ({ reason, reasonLabel });
  const labels = (cards: { reason: string; reasonLabel: string }[]) => attentionSections(cards).map(section => section.label);
  assert.deepEqual(labels([card('blocking-question', 'Blocking question')]), ['Blocking question']);
  assert.deepEqual(labels([card('blocking-question', 'Blocking question'), card('blocking-question', 'Blocking question')]), ['Blocking questions']);
  assert.deepEqual(labels([card('stale-session', 'Stale session'), card('stale-session', 'Stale session')]), ['Stale sessions']);
  assert.deepEqual(labels([card('proposed-memory', 'Proposed memory'), card('proposed-memory', 'Proposed memory')]), ['Proposed memories']);
  assert.deepEqual(labels([card('answer-possibly-unseen', 'Possibly unseen'), card('answer-possibly-unseen', 'Possibly unseen')]), ['Possibly unseen']);
});

test('every attention reason has a heading that is singular for one card and plural for several', () => {
  const singular = ['Open request', 'Possibly unseen', 'Blocking question', 'Lane waiting on you', 'Stale session', 'Proposed memory'];
  const plural = ['Open requests', 'Possibly unseen', 'Blocking questions', 'Lanes waiting on you', 'Stale sessions', 'Proposed memories'];
  const heading = (label: string, count: number) => attentionSections(Array.from({ length: count }, () => ({ reason: label, reasonLabel: label })))[0].label;
  assert.deepEqual(singular.map(label => heading(label, 1)), singular);
  assert.deepEqual(singular.map(label => heading(label, 2)), plural);
});
