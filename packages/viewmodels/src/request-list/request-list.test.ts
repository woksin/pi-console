import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestListViewModel } from './request-list.ts';
import { fixture, golden, now } from '../test-support.ts';

test('requests keep the API origin label and never claim launch or unproven prompts are the human', () => {
  const model = requestListViewModel({ requests: fixture.requests, sessions: fixture.sessions, now });
  for (const row of model.rows) {
    const request = fixture.requests.find(item => item.id === row.id)!;
    assert.equal(row.originLabel, request.originLabel);
    if (request.origin !== 'human') assert.notEqual(row.originLabel, 'Human request');
  }
  golden('request-list', model);
});

test('interrupted requests expose the partial answer separately from the final answer', () => {
  const row = requestListViewModel({ requests: fixture.requests, sessions: fixture.sessions, now }).rows.find(item => item.id === 'r1')!;
  assert.equal(row.answer, null);
  assert.ok(row.partial);
});

test('filter narrows by status', () => {
  const rows = requestListViewModel({ requests: fixture.requests, sessions: fixture.sessions, now, filter: 'interrupted' }).rows;
  assert.ok(rows.length > 0 && rows.every(row => row.status.status === 'interrupted'));
});
