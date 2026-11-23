import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticModels } from '../testing/synthetic-models.ts';
import { ConsoleQueries } from './console-queries.ts';

test('active-only keeps open and proven possibly-unseen requests, not historical unanswered or interrupted rows', () => {
  const models = syntheticModels({ sessions: 1, requests: 8, questions: 0, messages: 0, jobs: 0 });
  const rows = Object.values(models.requests.requests);
  rows[0].status = 'open';
  rows[1].status = 'unanswered';
  rows[2].status = 'interrupted';
  for (const row of rows.slice(3)) row.answerPossiblyUnseen = true;
  for (const row of rows.slice(4)) row.answer = { id: 'answer', text: 'done', at: row.createdAt, interim: false };
  rows[5].origin = 'unproven';
  rows[6].origin = 'launch';
  rows[7].status = 'interrupted';
  const queries = new ConsoleQueries(() => models, () => new Date('2026-06-01T00:00:00Z'));
  const snapshot = queries.screenSnapshot('t', 0);
  assert.deepEqual(snapshot.requests.map(row => row.id), [rows[0], rows[4], rows[6], rows[7]].map(row => row.id));
  assert.equal(snapshot.totals?.requests, 8);
  assert.ok(snapshot.bounded?.includes('requests'));
  assert.equal(queries.page('requests', { limit: 20, order: 'desc' }).items.length, 8);
  assert.equal(queries.screenSnapshot('t').requests.length, 8, 'recent history remains eligible');
});
