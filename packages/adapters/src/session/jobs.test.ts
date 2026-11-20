import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLine } from '../tailing/events.ts';
import { sessionMapper } from './mapper.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/sources.json', import.meta.url), 'utf8'));
const snapshot = {
  id: 'job-1', kind: 'command', command: 'echo synthetic', cwd: '/synthetic',
  logPath: '/synthetic/jobs/job-1.log', timeoutSeconds: 30,
  startedAt: Date.parse('2026-07-01T09:00:00Z'), status: 'running',
};

function mapJob(job: Record<string, unknown>, toolName = 'job_start') {
  const row = { ...fixture.jobStart, message: { ...fixture.jobStart.message, toolName, details: job } };
  return mapLine(JSON.stringify(row), 0, {
    mapper: sessionMapper('s'),
    checkpoint: { source: 'session-jsonl', identity: 'fixture', path: '/synthetic/session.jsonl', generation: 0, offset: 0, size: 0, mtimeMs: 1, headHash: '' },
  });
}

test('writer-shaped epoch-ms snapshots preserve job starts and terminal times', () => {
  for (const tool of ['job_start', 'job_watch', 'job_subscribe']) {
    const [start] = mapJob(snapshot, tool);
    assert.equal(start.type, 'JobStarted');
    assert.equal(start.occurredAt, '2026-07-01T09:00:00.000Z');
    const events = mapJob({ ...snapshot, status: 'succeeded', endedAt: snapshot.startedAt + 1000, exitCode: 0 }, tool);
    assert.deepEqual(events.map(event => event.type), ['JobStarted', 'JobFinished']);
    assert.equal(events[1].occurredAt, '2026-07-01T09:00:01.000Z');
    assert.equal((events[1].payload as Record<string, unknown>).exitCode, 0);
  }
});

test('invalid epoch timestamps fail closed without dropping valid zero epochs', () => {
  for (const invalid of [null, 'not a date', '2026-07-01T09:00:00Z', 1e20, undefined]) {
    assert.equal(mapJob({ ...snapshot, startedAt: invalid })[0].type, 'SourceSchemaUnknown');
    assert.equal(mapJob({ ...snapshot, status: 'failed', endedAt: invalid })[0].type, 'SourceSchemaUnknown');
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(mapJob({ ...snapshot, startedAt: invalid })[0].type, 'SourceSchemaUnknown');
  }
  assert.equal(mapJob({ ...snapshot, startedAt: 0 })[0].occurredAt, '1970-01-01T00:00:00.000Z');
});
