import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterQuestionRows, questionsViewModel } from './questions.ts';
import { fixture, golden, now } from '../test-support.ts';

test('open blocking questions sort first and counts add up', () => {
  const model = questionsViewModel({ questions: fixture.questions, sessions: fixture.sessions, now });
  assert.equal(model.rows[0].blocking, true);
  assert.equal(model.rows[0].status.status, 'needs-you');
  assert.equal(model.open, fixture.questions.filter(q => q.status === 'open').length);
  golden('questions', model);
});

test('the filter matches question text and session name, ignoring case', () => {
  const { rows } = questionsViewModel({ questions: fixture.questions, sessions: fixture.sessions, now });
  assert.deepEqual(filterQuestionRows(rows, ''), rows);
  const text = rows[0].text.slice(1, 6).toUpperCase();
  assert.ok(filterQuestionRows(rows, text).includes(rows[0]));
  assert.ok(filterQuestionRows(rows, rows[0].session).includes(rows[0]));
  assert.deepEqual(filterQuestionRows(rows, 'no-such-question-zzz'), []);
});
