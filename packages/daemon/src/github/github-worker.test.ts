import assert from 'node:assert/strict';
import test from 'node:test';
import type { NewEvent } from '@pi-console/contract';
import type { Lookup, QueryTarget } from '@pi-console/adapters';
import { freshState, type GithubState, type StateStore } from './github-state.ts';
import { GithubClosureWorker, type QuestionMeta } from './github-worker.ts';

const start = Date.parse('2026-01-01T00:00:00Z');
const closed: Lookup = { ok: true, kind: 'issue', state: 'closed', closedAt: '2025-12-31T00:00:00Z', resumeAt: null };
const unavailable: Lookup = { ok: false, failure: 'unavailable', resumeAt: null };
const question = (id: string, links: string[], extra: Partial<QuestionMeta> = {}): QuestionMeta => ({ id, revision: 1, status: 'open', links, ...extra });

function setup(initial: QuestionMeta[], options: { reply?: (target: QueryTarget) => Lookup | Promise<Lookup>; repositories?: string[]; store?: StateStore; saveFails?: boolean } = {}) {
  let clock = start;
  const world = { questions: initial, saved: undefined as GithubState | undefined };
  const events: NewEvent[] = [], lookups: QueryTarget[] = [], signals: AbortSignal[] = [];
  const store: StateStore = options.store ?? {
    load: now => world.saved ?? freshState(now),
    save: state => { if (options.saveFails) return false; world.saved = structuredClone(state); return true; },
  };
  const worker = new GithubClosureWorker({
    log: { append: async batch => { events.push(...batch); return { appended: batch.length } as never; } },
    questions: () => world.questions, repositories: options.repositories ?? ['a/b'], store, now: () => clock,
    lookup: async (target, signal) => { lookups.push(target); signals.push(signal); return (options.reply ?? (() => closed))(target); },
  });
  const advance = (ms: number) => { clock += ms; };
  /** The first poll only initialises; later polls may fetch. */
  const poll = async (ms = 0) => { advance(ms); await worker.poll(); };
  const states = () => events.map(event => (event.payload as { target: string; state: string }).state);
  return { world, worker, events, lookups, signals, advance, poll, states, store };
}

test('default-off equivalents: no repositories, a foreign repository or a non-open question spawn nothing', async () => {
  for (const [questions, repositories] of [[[question('q', ['a/b#1'])], []], [[question('q', ['x/y#1'])], ['a/b']], [[question('q', ['a/b#1'], { status: 'answered' })], ['a/b']], [[question('q', ['a/b#1'], { revision: 0 })], ['a/b']]] as const) {
    const test = setup([...questions], { repositories: [...repositories] });
    await test.poll(); await test.poll(11_000); await test.poll(11_000);
    assert.equal(test.lookups.length, 0);
    assert.equal(test.events.length, 0);
  }
});

test('the first poll fetches nothing; later polls look up each due target once and publish for every linked question', async () => {
  const test = setup([question('q1', ['a/b#1']), question('q2', ['https://github.com/A/B/issues/1'])]);
  await test.poll();
  assert.equal(test.lookups.length, 0);
  await test.poll(1_000);
  assert.deepEqual(test.lookups, [{ owner: 'a', repo: 'b', number: 1 }]);
  assert.deepEqual(test.events.map(event => event.subject).sort(), ['question:q1', 'question:q2']);
  assert.deepEqual(test.states(), ['closed', 'closed']);
  await test.poll(1_000);
  assert.equal(test.events.length, 2);
});

test('all or nothing: a question linking a foreign repository, prose or too many targets is never queried', async () => {
  const many = Array.from({ length: 51 }, (_, index) => `a/b#${String(index + 1)}`);
  const test = setup([question('q1', ['a/b#1', 'x/y#2']), question('q2', ['a/b#2', 'see the thread']), question('q3', many), question('q4', ['--repo/x#1'])]);
  await test.poll(); await test.poll(11_000);
  assert.equal(test.lookups.length, 0);
});

test('at most one request per ten seconds, 120 per rolling hour, reserved and persisted before the child starts', async () => {
  const targets = Array.from({ length: 200 }, (_, index) => question(`q${String(index)}`, [`a/b#${String(index + 1)}`]));
  const test = setup(targets);
  await test.poll();
  await test.poll(1_000); assert.equal(test.lookups.length, 1);
  await test.poll(1_000); assert.equal(test.lookups.length, 1);
  await test.poll(9_000); assert.equal(test.lookups.length, 2);
  for (let index = 0; index < 330; index++) await test.poll(10_000);
  assert.equal(test.lookups.length, 120);
  await test.poll(2 * 3_600_000);
  assert.ok(test.lookups.length > 120);
  const reservedFirst = setup([question('q', ['a/b#1'])]);
  reservedFirst.world.saved = undefined;
  await reservedFirst.poll();
  let reservedBeforeSpawn = -1;
  const worker = new GithubClosureWorker({
    log: { append: async () => ({}) as never }, questions: () => [question('q', ['a/b#1'])], repositories: ['a/b'], now: () => start,
    store: { load: now => freshState(now), save: state => { reservedBeforeSpawn = state.reservations.length; return true; } },
    lookup: async () => { assert.equal(reservedBeforeSpawn, 1); return closed; },
  });
  await worker.poll(); await worker.poll();
});

test('a failed refresh is recorded as unknown, superseding the earlier success, and backs off at least fifteen minutes', async () => {
  let reply: Lookup = closed;
  const test = setup([question('q', ['a/b#1'])], { reply: () => reply });
  await test.poll(); await test.poll(1_000);
  assert.deepEqual(test.states(), ['closed']);
  reply = unavailable;
  await test.poll(15 * 60_000 + 1_000);
  assert.equal(test.lookups.length, 2);
  assert.deepEqual(test.states(), ['closed', 'unknown']);
  assert.deepEqual([test.events[1].payload, test.events[1].occurredAt].map(item => typeof item), ['object', 'string']);
  await test.poll(14 * 60_000);
  assert.equal(test.lookups.length, 2);
  await test.poll(2 * 60_000);
  assert.equal(test.lookups.length, 3);
});

test('refresh failures back off exponentially up to an hour, and a throwing lookup is a failure, not a crash', async () => {
  const test = setup([question('q', ['a/b#1'])], { reply: () => { throw new Error('boom'); } });
  await test.poll(); await test.poll(1_000);
  assert.deepEqual(test.states(), ['unknown']);
  const gaps: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = test.lookups.length;
    let waited = 0;
    while (test.lookups.length === before) { await test.poll(60_000); waited += 60_000; }
    gaps.push(waited / 60_000);
  }
  assert.deepEqual(gaps, [15, 30, 60, 60]);
});

test('a rate limit pauses everything for at least an hour, or until the reported reset', async () => {
  let reply: Lookup = { ok: false, failure: 'rate-limited', resumeAt: new Date(start + 3 * 3_600_000).toISOString() };
  const test = setup([question('q', ['a/b#1']), question('r', ['a/b#2'])], { reply: () => reply });
  await test.poll(); await test.poll(1_000);
  assert.equal(test.lookups.length, 1);
  reply = closed;
  await test.poll(2 * 3_600_000);
  assert.equal(test.lookups.length, 1);
  await test.poll(3_600_000);
  assert.equal(test.lookups.length, 2);
});

test('a cached observation is reused for a newly linked question without another request and keeps its original fetch time', async () => {
  const test = setup([question('q1', ['a/b#1'])]);
  await test.poll(); await test.poll(1_000);
  test.world.questions = [question('q1', ['a/b#1']), question('q2', ['a/b#1'])];
  await test.poll(1_000);
  assert.equal(test.lookups.length, 1);
  const [first, second] = test.events.filter(event => (event.payload as { questionId: string }).questionId !== '').map(event => event.payload as { fetchedAt: string; questionId: string });
  assert.equal(first.fetchedAt, second.fetchedAt);
  assert.deepEqual(test.events.map(event => event.subject), ['question:q1', 'question:q2']);
});

test('relinking: a new link-set revision is a new association with its own event identity; evidence is never renewed by re-publishing', async () => {
  const test = setup([question('q1', ['a/b#1'])]);
  await test.poll(); await test.poll(1_000);
  test.world.questions = [question('q1', ['a/b#1'], { revision: 2 })];
  await test.poll(1_000);
  assert.equal(test.events.length, 2);
  assert.notEqual(test.events[0].idempotencyKey, test.events[1].idempotencyKey);
  assert.equal((test.events[0].payload as { fetchedAt: string }).fetchedAt, (test.events[1].payload as { fetchedAt: string }).fetchedAt);
  assert.equal(test.lookups.length, 1);
});

test('questions that close, change links or vanish during a lookup are not published for', async () => {
  const test = setup([question('q1', ['a/b#1'])], { reply: () => { test.world.questions = [question('q1', ['a/b#1'], { status: 'answered' })]; return closed; } });
  await test.poll(); await test.poll(1_000);
  assert.equal(test.lookups.length, 1);
  assert.equal(test.events.length, 0);
  test.world.questions = [question('q1', ['a/b#1', 'x/y#9'])];
  await test.poll(1_000);
  assert.equal(test.events.length, 0);
});

test('a huge question set is covered in bounded rotating windows', async () => {
  const many = Array.from({ length: 250 }, (_, index) => question(`q${String(index)}`, ['a/b#1']));
  const test = setup(many);
  await test.poll();
  await test.poll(1_000);
  assert.equal(test.events.length, 100);
  await test.poll(1_000); assert.equal(test.events.length, 200);
  await test.poll(1_000); assert.equal(test.events.length, 250);
  assert.equal(test.lookups.length, 1);
});

test('persistence failure halts fetching instead of resetting the budget, and reports one error', async () => {
  const test = setup([question('q', ['a/b#1'])], { saveFails: true });
  await test.poll(); await test.poll(1_000); await test.poll(60_000);
  assert.equal(test.lookups.length, 0);
  assert.equal(test.worker.status.errors, 1);
});

test('a clock moving backwards never reopens the budget or earlier backoff', async () => {
  const test = setup([question('q', ['a/b#1'])]);
  await test.poll(); await test.poll(1_000);
  test.advance(-3 * 3_600_000);
  await test.poll(); await test.poll(5_000);
  assert.equal(test.lookups.length, 1);
});

test('abort ends the run: no further lookup, the lookup signal fires and nothing is recorded for an aborted lookup', async () => {
  let release!: (value: Lookup) => void;
  const test = setup([question('q', ['a/b#1'])], { reply: () => new Promise<Lookup>(resolve => { release = resolve; }) });
  await test.poll();
  const running = test.poll(1_000);
  await new Promise(resolve => setImmediate(resolve));
  test.worker.abort();
  assert.equal(test.signals[0].aborted, true);
  release(unavailable);
  await running;
  assert.equal(test.events.length, 0);
  await test.poll(60_000);
  assert.equal(test.lookups.length, 1);
});

test('prototype-like repository and question names cannot corrupt the cache', async () => {
  const test = setup([question('__proto__', ['constructor/__proto__#1'])], { repositories: ['constructor/__proto__'] });
  await test.poll(); await test.poll(1_000);
  assert.equal(test.lookups.length, 1);
  assert.equal(({} as Record<string, unknown>).fetchedAt, undefined);
});
