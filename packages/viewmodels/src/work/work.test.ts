import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterWorkRows, workRowAt, workStructure, workViewModel } from './work.ts';
import { fixture, golden, now } from '../test-support.ts';

test('work lists failures first and counts running jobs', () => {
  const model = workViewModel({ jobs: fixture.jobs, sessions: fixture.sessions, now });
  assert.equal(model.rows.length, fixture.jobs.length);
  assert.equal(model.running, fixture.jobs.filter(job => job.status === 'running').length);
  const order = model.rows.map(row => row.status.status);
  assert.ok(order.indexOf('failed') <= order.indexOf('done') || !order.includes('failed'));
  golden('work', model);
});

test('the filter trims and matches job identity, session, kind, name, status and exit, ignoring case', () => {
  const { rows } = workViewModel({ jobs: fixture.jobs, sessions: fixture.sessions, now });
  assert.deepEqual(filterWorkRows(rows, '  '), rows);
  assert.ok(filterWorkRows(rows, ` ${rows[0].name.toUpperCase()} `).includes(rows[0]));
  assert.ok(filterWorkRows(rows, rows[0].status.label).includes(rows[0]));
  assert.ok(filterWorkRows(rows, rows[0].session).includes(rows[0]));
  assert.deepEqual(filterWorkRows(rows, 'no-such-job-zzz'), []);
});

test('the clock-free structure formats the same rows for any clock and matches the wrapper', () => {
  const input = { jobs: fixture.jobs, sessions: fixture.sessions };
  const structure = workStructure(input);
  const model = workViewModel({ ...input, now });
  assert.deepEqual(structure.entries.map(entry => workRowAt(entry, now)), model.rows);
  assert.deepEqual([structure.running, structure.failed], [model.running, model.failed]);
  const later = structure.entries.map(entry => workRowAt(entry, now + 7_200_000));
  assert.deepEqual(later.map(row => row.id), model.rows.map(row => row.id));
  assert.ok(later.some((row, index) => row.age !== model.rows[index].age));
  assert.deepEqual(filterWorkRows(structure.entries, 'no-such-job-zzz'), []);
});
