import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadModels } from '../projections/index.ts';
import { syntheticModels } from '../testing/synthetic-models.ts';
import { ConsoleQueries } from './console-queries.ts';
import { InvalidCursorError, type PageCollection } from './paging.ts';
import { recentWindow, sessionCap } from './screen-snapshot.ts';

const now = () => new Date('2026-06-01T00:00:00Z');
const small = () => syntheticModels({ sessions: 40, jobs: 5000, messages: 2000, requests: 2000, questions: 1000 });
const queriesOver = (models: ReadModels) => new ConsoleQueries(() => models, now);

function resetModels(): ReadModels {
  const models = syntheticModels({ sessions: 600, jobs: 0, messages: 0, requests: 0, questions: 0 });
  Object.values(models.sessions.sessions).forEach((session, owner) => {
    session.resets = Array.from({ length: 10 }, (_, index) => ({
      id: `reset-${session.id}-${index}`, kind: 'compaction', at: new Date(Date.UTC(2026, 0, 1) + (owner * 10 + index) * 1000).toISOString(),
      carriedRequestIds: [], interruptedRequestIds: [],
    }));
  });
  return models;
}

test('thousands of resets are capped to the newest of kept sessions with full totals and deterministic order', () => {
  const models = resetModels();
  const queries = queriesOver(models);
  const snapshot = queries.screenSnapshot('t');
  const kept = new Set(snapshot.sessions.map(session => session.id));
  const eligible = queries.resets().filter(reset => kept.has(reset.sessionId));
  assert.equal(snapshot.resets.length, recentWindow);
  assert.ok(snapshot.resets.every(reset => kept.has(reset.sessionId)));
  assert.deepEqual(snapshot.resets, eligible.slice(-recentWindow).reverse());
  assert.equal(snapshot.totals?.resets, 6000);
  assert.ok(snapshot.bounded?.includes('resets'));
  assert.ok(kept.size < 600);
  assert.deepEqual(queries.screenSnapshot('t'), snapshot);
  const reversed = structuredClone(models);
  reversed.sessions.sessions = Object.fromEntries(Object.entries(reversed.sessions.sessions).reverse());
  for (const session of Object.values(reversed.sessions.sessions)) session.resets.reverse();
  assert.deepEqual(queriesOver(reversed).screenSnapshot('t'), snapshot);
});

test('active-only omits reset history while session detail and keyset pages retain it all', () => {
  const queries = queriesOver(resetModels());
  const active = queries.screenSnapshot('t', 0);
  assert.deepEqual(active.resets, []);
  assert.equal(active.totals?.resets, 6000);
  assert.ok(active.bounded?.includes('resets'));
  const sessionId = active.sessions[0].id;
  const first = queries.page('resets', { limit: 6, order: 'desc', sessionId });
  const second = queries.page('resets', { limit: 6, order: 'desc', sessionId, after: first.nextCursor ?? undefined });
  assert.equal(first.total, 10);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.deepEqual([...first.items, ...second.items], queries.session(sessionId)?.resets.slice().reverse());
});

test('the screen snapshot holds every active item plus the newest window, in the existing ascending order', () => {
  const models = small();
  const queries = queriesOver(models);
  const snapshot = queries.screenSnapshot('2026-06-01T00:00:00Z');
  const full = queries.jobs();
  const activeIds = full.filter(job => job.status === 'running').map(job => job.id);
  const ids = snapshot.jobs.map(job => job.id);
  for (const id of activeIds) assert.ok(ids.includes(id), id);
  for (const job of full.slice(-recentWindow)) assert.ok(ids.includes(job.id), job.id);
  assert.equal(ids.length, new Set([...activeIds, ...full.slice(-recentWindow).map(job => job.id)]).size);
  assert.deepEqual(snapshot.jobs, full.filter(job => ids.includes(job.id)));
  assert.ok(queries.messages().filter(message => message.status !== 'read').every(message => snapshot.messages.some(item => item.id === message.id)));
  assert.ok(queries.requests().filter(request => request.status === 'open').every(request => snapshot.requests.some(item => item.id === request.id)));
  assert.ok(queries.questions().filter(question => question.status === 'open').every(question => snapshot.questions.some(item => item.id === question.id)));
});

test('totals are the full counts and bounded names exactly the windowed collections', () => {
  const queries = queriesOver(small());
  const snapshot = queries.screenSnapshot('t');
  assert.deepEqual(snapshot.totals, { sessions: 40, requests: 2000, questions: 1000, messages: 2000, jobs: 5000, resets: 0 });
  assert.deepEqual(snapshot.bounded, ['requests', 'questions', 'messages', 'jobs']);
  const tiny = queriesOver(syntheticModels({ sessions: 3, jobs: 5, messages: 5, requests: 5, questions: 5 })).screenSnapshot('t');
  assert.deepEqual(tiny.bounded, []);
  assert.equal(tiny.jobs.length, 5);
});

test('the same models give identical JSON, whatever the row insertion order', () => {
  const models = small();
  const queries = queriesOver(models);
  const first = JSON.stringify(queries.screenSnapshot('t'));
  assert.equal(JSON.stringify(queries.screenSnapshot('t')), first);
  const reversed = { ...models, work: { ...models.work, jobs: Object.fromEntries(Object.entries(models.work.jobs).reverse()) } };
  assert.equal(JSON.stringify(queriesOver(reversed).screenSnapshot('t')), first);
});

test('items the needs-you list points at stay in the window however old they are', () => {
  const models = small();
  models.requests.requests.r0000001 = { ...models.requests.requests.r0000001, status: 'answered', answerPossiblyUnseen: true, answer: { id: 'a', text: 'x', at: '2026-01-01T00:00:00Z', interim: false } };
  models.questions.questions.k0000002 = { ...models.questions.questions.k0000002, blocking: true, status: 'open' };
  const snapshot = queriesOver(models).screenSnapshot('t');
  assert.ok(snapshot.requests.some(request => request.id === 'r0000001'));
  assert.ok(snapshot.questions.some(question => question.id === 'k0000002'));
});

test('a snapshot of 50,000 jobs is a small bounded frame', () => {
  const models = syntheticModels({ sessions: 300, jobs: 50_000, messages: 5000, requests: 5000, questions: 500 });
  const snapshot = queriesOver(models).screenSnapshot('t');
  assert.equal(snapshot.totals?.jobs, 50_000);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024);
});

test('past the session cap only active, newest, owning and parent sessions are kept', () => {
  const models = syntheticModels({ sessions: sessionCap + 300, jobs: 100, messages: 0, requests: 0, questions: 0 });
  const snapshot = queriesOver(models).screenSnapshot('t');
  assert.equal(snapshot.totals?.sessions, sessionCap + 300);
  assert.ok(snapshot.bounded?.includes('sessions'));
  assert.ok(snapshot.sessions.length < sessionCap + 300);
  const kept = new Set(snapshot.sessions.map(session => session.id));
  for (const session of snapshot.sessions) if (session.parentSessionId) assert.ok(kept.has(session.parentSessionId), session.id);
  for (const job of snapshot.jobs) assert.ok(kept.has(job.sessionId), job.id);
  assert.ok(kept.has('s0000000'));
});

const collections: [PageCollection, (queries: ConsoleQueries) => { id: string }[]][] = [
  ['jobs', queries => queries.jobs()], ['messages', queries => queries.messages()], ['requests', queries => queries.requests()],
  ['questions', queries => queries.questions()], ['sessions', queries => queries.sessions()],
];

for (const [collection, list] of collections) {
  test(`${collection} paging walks every row once, in order, and descending is the exact reverse`, () => {
    const queries = queriesOver(small());
    const full = list(queries);
    for (const order of ['asc', 'desc'] as const) {
      const walked: unknown[] = [];
      let after: string | undefined;
      for (;;) {
        const page = queries.page(collection, { limit: 333, after, order });
        assert.equal(page.total, full.length);
        walked.push(...page.items);
        assert.equal(page.hasMore, page.nextCursor !== null);
        if (!page.hasMore) break;
        after = page.nextCursor ?? undefined;
      }
      assert.deepEqual(walked, order === 'asc' ? full : [...full].reverse());
    }
  });
}

test('malformed and foreign cursors are rejected', () => {
  const queries = queriesOver(small());
  const jobsCursor = queries.page('jobs', { limit: 1 }).nextCursor ?? '';
  assert.throws(() => queries.page('jobs', { limit: 1, after: 'not a cursor' }), InvalidCursorError);
  assert.throws(() => queries.page('messages', { limit: 1, after: jobsCursor }), InvalidCursorError);
  assert.throws(() => queries.page('jobs', { limit: 1, after: Buffer.from('[1,2,3]').toString('base64url') }), InvalidCursorError);
});

test('paging walks 46,000 jobs with no gap or duplicate and filters by session', () => {
  const models = syntheticModels({ sessions: 10, jobs: 46_000, messages: 0, requests: 0, questions: 0 });
  const queries = queriesOver(models);
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const page = queries.page('jobs', { limit: 1000, after });
    for (const item of page.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    if (!page.hasMore) break;
    after = page.nextCursor ?? undefined;
  }
  assert.equal(seen.size, 46_000);
  const mine = queries.page('jobs', { limit: 1000, sessionId: 's0000003' });
  assert.equal(mine.total, 4600);
});
