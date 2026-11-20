import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionsViewModel } from './questions.ts';
import { fixture, golden, now } from '../test-support.ts';

test('open blocking questions sort first and counts add up', () => {
  const model = questionsViewModel({ questions: fixture.questions, sessions: fixture.sessions, now });
  assert.equal(model.rows[0].blocking, true);
  assert.equal(model.rows[0].status.status, 'needs-you');
  assert.equal(model.open, fixture.questions.filter(q => q.status === 'open').length);
  golden('questions', model);
});
