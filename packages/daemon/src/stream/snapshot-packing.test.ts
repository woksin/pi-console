import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { Snapshot } from '@pi-console/contract';
import { ConsoleQueries } from '@pi-console/core';
import { syntheticModels } from '@pi-console/core/testing';
import { safeJson } from '../http/output.ts';
import { collections } from './snapshot-candidates.ts';
import { packSnapshot } from './snapshot-packing.ts';
import { StreamHub } from './stream-hub.ts';

const at = '2026-06-01T00:00:00.000Z';
const now = () => new Date(at);
const encode = (payload: unknown) => `id: 123456789\nevent: snapshot\ndata: ${safeJson({ seq: 123456789, type: 'snapshot', occurredAt: at, payload })}\n\n`;
const read = (text: string): Snapshot => (JSON.parse(text.split('data: ')[1]) as { payload: Snapshot }).payload;

function empty(snapshot: Snapshot): Snapshot {
  return { ...snapshot, repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], bounded: [...collections] };
}

function connect(queries: ConsoleQueries, cap: number): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const hub = new StreamHub({ base: 123456789, persist: () => undefined, ringSize: 10, heartbeatMs: 60000,
    maxBufferedBytes: cap, now, warn: message => warnings.push(message), snapshot: active => queries.screenSnapshot(at, active ? 0 : undefined) });
  const client = Object.assign(new EventEmitter(), {
    text: '', destroyed: false, writableLength: 0, writeHead: () => undefined, flushHeaders: () => undefined,
    write(text: string) { this.text += text; }, destroy() { this.destroyed = true; },
  });
  try { hub.connect(client as unknown as ServerResponse, undefined); return { text: client.text, warnings }; } finally { hub.close(); }
}

function assertClosure(snapshot: Snapshot): void {
  const ids = new Set(snapshot.sessions.map(row => row.id));
  const repos = new Set(snapshot.repositories.map(row => row.id));
  for (const row of snapshot.sessions) {
    if (row.parentSessionId) assert.ok(ids.has(row.parentSessionId));
    assert.ok(repos.has(row.repositoryId));
  }
  for (const row of [...snapshot.requests, ...snapshot.questions, ...snapshot.jobs, ...snapshot.resets]) assert.ok(ids.has(row.sessionId));
}

test('a large actionable backlog bootstraps newest bundles under the wire cap and every omission is REST-reachable', () => {
  const models = syntheticModels({ sessions: 40, requests: 2400, questions: 300, jobs: 500, messages: 500 }, 1);
  for (const row of Object.values(models.requests.requests)) { row.status = 'open'; row.text = '😀 <ask>& '.repeat(40); }
  const queries = new ConsoleQueries(() => models, now);
  const cap = 24000;
  const { text, warnings } = connect(queries, cap);
  const snapshot = read(text);
  assert.ok(Buffer.byteLength(text) <= cap / 2, 'compaction prefers half the output cap');
  assert.equal(warnings.length, 1);
  assert.ok(snapshot.requests.length > 0, 'not an empty fallback');
  assert.ok(snapshot.requests.some(row => row.id === 'r0002399'), 'newest actionable request is visible');
  assert.ok(!snapshot.requests.some(row => row.id === 'r0000000'), 'older backlog cannot displace the newest');
  assert.deepEqual(snapshot.totals, queries.screenSnapshot(at).totals);
  assertClosure(snapshot);
  for (const collection of collections) {
    const reached = new Set<string>();
    let after: string | undefined;
    do {
      const page = queries.page(collection, { limit: 173, order: 'desc', after });
      for (const row of page.items) reached.add(row.id);
      after = page.nextCursor ?? undefined;
    } while (after);
    assert.equal(reached.size, snapshot.totals?.[collection]);
    assert.ok(snapshot[collection].every(row => reached.has(row.id)));
    assert.equal(snapshot.bounded?.includes(collection), snapshot[collection].length < reached.size);
  }
});

test('a normal snapshot above half the cap still attempts active-only even when normal fits the full cap', () => {
  const models = syntheticModels({ sessions: 1, requests: 3, questions: 0, jobs: 0, messages: 0 });
  const queries = new ConsoleQueries(() => models, now);
  const normal = queries.screenSnapshot(at);
  const cap = Buffer.byteLength(encode(normal));
  const { text, warnings } = connect(queries, cap);
  assert.equal(text, encode(queries.screenSnapshot(at, 0)));
  assert.equal(warnings.length, 1);
});

test('bundle accounting is byte-exact for escaping, unicode, envelope, shared ancestors and repository closure', () => {
  const models = syntheticModels({ sessions: 3, requests: 1, questions: 0, jobs: 0, messages: 0 });
  const sessions = Object.values(models.sessions.sessions);
  sessions[0].openTurnId = null; sessions[0].endedAt = at;
  sessions[1].parentSessionId = sessions[0].id;
  sessions[2].parentSessionId = sessions[1].id;
  const request = Object.values(models.requests.requests)[0];
  request.status = 'open'; request.sessionId = sessions[2].id; request.text = '😀 <script>&"\\\n\u2028\u2029';
  const snapshot = new ConsoleQueries(() => models, now).screenSnapshot(at);
  const exact = encode(snapshot);
  const cap = Buffer.byteLength(exact);
  const packed = packSnapshot(snapshot, snapshot, empty(snapshot), { encode, preferred: cap, hard: cap })!;
  assert.equal(packed, exact);
  assert.ok(packed.includes(safeJson(request.text)));
  assert.ok(Buffer.byteLength(packed) > packed.length, 'UTF-8 bytes, not string length');
  const smaller = packSnapshot(snapshot, snapshot, empty(snapshot), { encode, preferred: cap - 1, hard: cap - 1 })!;
  assert.ok(Buffer.byteLength(smaller) <= cap - 1);
  assert.deepEqual(read(smaller).requests, [], 'the owner/ancestor/repository bundle cannot be partly admitted');
  assertClosure(read(smaller));
});

test('an oversized newest bundle is skipped, actionable work precedes newer running work, and metadata is insertion-independent', () => {
  const models = syntheticModels({ sessions: 2, requests: 3, questions: 1, jobs: 1, messages: 0 }, 1);
  const requests = Object.values(models.requests.requests);
  for (const row of requests) row.status = 'open';
  requests[2].text = 'huge'.repeat(10000);
  Object.values(models.work.jobs)[0].startedAt = at;
  Object.values(models.questions.questions)[0].blocking = true;
  const queries = new ConsoleQueries(() => models, now);
  const normal = queries.screenSnapshot(at);
  const cap = 3500;
  const packed = packSnapshot(normal, normal, empty(normal), { encode, preferred: cap, hard: cap })!;
  const snapshot = read(packed);
  assert.ok(snapshot.requests.some(row => row.id === requests[1].id));
  assert.ok(!snapshot.requests.some(row => row.id === requests[2].id));
  assert.ok(snapshot.questions.length > 0, 'blocking questions share the actionable tier');
  assertClosure(snapshot);
  const reversed = structuredClone(normal);
  for (const collection of [...collections, 'repositories'] as const) reversed[collection].reverse();
  assert.equal(packSnapshot(reversed, reversed, empty(reversed), { encode, preferred: cap, hard: cap }), packed);
  assert.ok(Buffer.byteLength(packed) <= cap);
});

test('an older blocking question outranks a newer nonblocking question under a one-question budget', () => {
  const models = syntheticModels({ sessions: 1, requests: 0, questions: 2, jobs: 0, messages: 0 }, 1);
  const [blocking, nonblocking] = Object.values(models.questions.questions);
  blocking.blocking = true;
  blocking.text = nonblocking.text;
  const normal = new ConsoleQueries(() => models, now).screenSnapshot(at);
  const cap = Buffer.byteLength(encode({ ...normal, questions: [normal.questions[1]], bounded: ['questions'] }));
  assert.ok(Buffer.byteLength(encode(normal)) > cap, 'only one question and its owner can fit');
  const packed = packSnapshot(normal, normal, empty(normal), { encode, preferred: cap, hard: cap })!;
  const snapshot = read(packed);
  assert.deepEqual(snapshot.questions.map(row => row.id), [blocking.id]);
  assert.deepEqual(snapshot.bounded, ['questions']);
  assertClosure(snapshot);
});
