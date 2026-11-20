import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workViewModel } from './work.ts';
import { fixture, golden, now } from '../test-support.ts';

test('work lists failures first and counts running jobs', () => {
  const model = workViewModel({ jobs: fixture.jobs, sessions: fixture.sessions, now });
  assert.equal(model.rows.length, fixture.jobs.length);
  assert.equal(model.running, fixture.jobs.filter(job => job.status === 'running').length);
  const order = model.rows.map(row => row.status.status);
  assert.ok(order.indexOf('failed') <= order.indexOf('done') || !order.includes('failed'));
  golden('work', model);
});
