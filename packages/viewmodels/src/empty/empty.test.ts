import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStates, firstRunChecklist, overviewEmpty } from './empty.ts';

test('empty states use the information architecture wording', () => {
  assert.equal(emptyStates.fleet.title, 'No pi sessions found yet.');
  assert.equal(emptyStates.requests.title, 'No requests recorded yet.');
  assert.equal(`${emptyStates.questions.title} ${emptyStates.questions.body}`, 'No open questions. Agents ask here when they need you.');
  assert.equal(emptyStates.timeline.title, 'Waiting for activity');
  assert.equal(emptyStates.graph.title, 'Waiting for activity');
  assert.ok(Object.values(emptyStates).every(state => state.body.endsWith('.') && state.mark.length > 0));
});

test('fleet first run gives the start-pi instruction only once across the empty state and checklist', () => {
  const checklist = firstRunChecklist({ connected: true, sessions: 0 });
  const copy = [emptyStates.fleet.body, ...checklist.steps.map(item => item.detail)].join(' ');
  assert.equal(copy.match(/Start pi in any repository/g)?.length, 1);
});

test('the calm Overview promotes the working count', () => {
  assert.deepEqual(overviewEmpty(11), { title: 'Nothing needs you.', mark: '✓', body: '11 sessions are working.' });
  assert.equal(overviewEmpty(1).body, '1 session is working.');
  assert.equal(overviewEmpty(0).body, 'No session is working right now.');
});

test('the first-run checklist ticks what it can see and keeps the extension optional', () => {
  const fresh = firstRunChecklist({ connected: true, sessions: 0 });
  assert.deepEqual(fresh.steps.map(item => [item.label, item.state, item.glyph]), [
    ['Daemon running', 'done', '✓'], ['Sources detected', 'todo', '○'], ['Extension installed', 'optional', '◇'],
  ]);
  assert.match(firstRunChecklist({ connected: false, sessions: 0 }).steps[0].detail, /packages\/cli\/bin\/pi-console\.mjs daemon --web-dist packages\/web\/dist/);
  assert.equal(firstRunChecklist({ connected: true, sessions: 3 }).steps[1].state, 'done');
});
