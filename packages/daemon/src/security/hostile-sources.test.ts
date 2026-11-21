import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EventLog } from '@pi-console/contract';
import { SqliteEventLog } from '@pi-console/core';
import {
  contextMapper, issueMapper, laneMapper, laneMessageMapper, opaqueLogMapper, orchMapper,
  phaseMapper, pollSnapshot, questionMapper, rosterMapper, sessionTailer, type Mapper,
} from '@pi-console/adapters';
import { specDaemon, type SpecDaemon } from '../testing/harness.ts';

const at = '2026-07-01T09:00:00Z';
const fixtures = JSON.parse(readFileSync(new URL('../../../adapters/src/fixtures/sources.json', import.meta.url), 'utf8'));

function snapshots(id: string): [string, Mapper, Record<string, unknown>][] {
  const question = { ...fixtures.legacyQuestion, id, createdBy: id, history: [{ seq: 1, at, type: 'created', actor: id }] };
  return [
    ['question-store', questionMapper, question],
    ['question-store', questionMapper, { ...question, rev: 2, history: [{ seq: 2, at, type: 'edited', actor: id }] }],
    ['question-store', questionMapper, { ...question, rev: 3, answer: { text: 'synthetic' }, history: [{ seq: 3, at, type: 'answered', actor: id }] }],
    ['question-store', questionMapper, { ...fixtures.question, id: `${id}-v1`, createdBy: id }],
    ['context-budget', contextMapper, { ...fixtures.context[1], sessionId: id, path: id }],
    ['lane-messages', laneMapper, { ...fixtures.lanes, lanes: [{ ...fixtures.lanes.lanes[0], id }] }],
    ['lane-messages', rosterMapper, { ...fixtures.roster, id }],
    ['lane-messages', laneMessageMapper, { text: `From ${id}: synthetic prose` }],
    ['lane-messages', orchMapper, { ...fixtures.orch[0], id, from: id, to: id }],
    ['lane-heartbeats', orchMapper, { ...fixtures.orch[2], sessionId: id }],
    ['lane-messages', orchMapper, { ...fixtures.orch[1], msgId: id, by: id }],
    ['issue-work', issueMapper, { ...fixtures.issue, repo: id, sessionId: id }],
    ['phase-ledger', phaseMapper, { ...fixtures.phase, argvHash: id, sessionId: id }],
    ['job-log', opaqueLogMapper, { id }],
    ['review-log', opaqueLogMapper, { id }],
  ];
}

async function ingest(spec: { directory: string; log: EventLog }, id: string): Promise<void> {
  const header = { type: 'session', version: 3, id, cwd: '/synthetic', timestamp: at };
  const job = { ...fixtures.jobStart, message: { ...fixtures.jobStart.message, details: { id, label: 'synthetic', startedAt: Date.parse(at), status: 'running' } } };
  const completion = { ...fixtures.jobs, details: { completions: [{ completionId: id, job: { id, status: 'succeeded', exitCode: 0 } }] } };
  const path = join(spec.directory, 'session.jsonl');
  const bytes = [header, job, completion].map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(path, bytes);
  const tailer = sessionTailer(spec.log, path);
  try { await tailer.poll([path]); } finally { await tailer.close(); }
  assert.equal(readFileSync(path, 'utf8'), bytes);
  for (const [index, [source, mapper, row]] of snapshots(id).entries()) {
    const file = join(spec.directory, `${index}-${source}.json`);
    const original = JSON.stringify(row);
    writeFileSync(file, original);
    if (source === 'phase-ledger') {
      // Pre-existing gap: phase:* is not an allowed envelope subject kind.
      const facts = mapper(JSON.parse(readFileSync(file, 'utf8')));
      assert.deepEqual(facts.map(fact => fact.type), ['PhaseQueued', 'PhaseStarted', 'PhaseFinished']);
      assert.ok(facts.every(fact => fact.payload.phaseId === `${id}:${fixtures.phase.queuedAt}`));
    } else {
      await pollSnapshot(spec.log, source, file, mapper, { roots: [spec.directory] });
    }
    assert.equal(readFileSync(file, 'utf8'), original);
  }
}

async function recorded(id: string) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-hostile-sources-'));
  const log = new SqliteEventLog(join(directory, 'sources.db'));
  try {
    await ingest({ directory, log }, id);
    const events = [];
    for await (const event of log.readFrom(0)) events.push(event);
    return events;
  } finally {
    log.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function get(spec: SpecDaemon, route: string) {
  const response = await fetch(`http://${spec.daemon.address}:${spec.daemon.port}/api/v1/${route}`, { headers: { Authorization: `Bearer ${spec.token}` } });
  assert.equal(response.status, 200, route);
  return response.json();
}

for (const id of ['__proto__', 'constructor', 'toString']) {
  test(`planted source ids survive ingestion, projection and API queries: ${id}`, async t => {
    const prototypes = [Object.prototype, Array.prototype, Function.prototype].map(value => Object.getOwnPropertyDescriptors(value));
    const events = await recorded(id);
    assert.ok(events.length > 10);
    assert.deepEqual(events.filter(event => event.type === 'SourceSchemaUnknown').map(event => event.payload), []);
    // Seed from the durable adapter output; daemon startup replays it before serving queries.
    const spec = await specDaemon(events);
    t.after(() => spec.close());
    for (const route of ['sessions', 'jobs', 'questions', 'messages']) {
      const body = await get(spec, route);
      assert.ok(body.items.some((item: Record<string, unknown>) => item.id === id), `${route}: ${JSON.stringify(body)}`);
    }
    await get(spec, `sessions/${encodeURIComponent(id)}`);
    for (const route of ['overview', 'graph', 'needs-you', 'requests']) await get(spec, route);
    assert.deepEqual([Object.prototype, Array.prototype, Function.prototype].map(value => Object.getOwnPropertyDescriptors(value)), prototypes);
  });
}
