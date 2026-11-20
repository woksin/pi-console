/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are untyped JSON that specs validate against the schema */
// One API v1 conformance suite for every daemon implementation: the testkit mock and the real daemon must both pass
// it unchanged (docs/api/v1.md). It covers the read routes, the security boundary and SSE snapshot/delta/resume.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { apiV1Schema as schema, validate } from '@pi-console/contract';
import { call, openStream, type Reply } from './client.ts';

export interface ConformanceTarget {
  port: number;
  /** The address the server is bound to. */
  address: string;
  token: string;
  /** Causes exactly one new SSE delta and resolves once it has been published. */
  emit(): Promise<void>;
  /** An isolated idle session and an entity lifecycle that emits entity + derived-session updates. */
  attentionSessionId: string;
  emitAttention(kind: 'request' | 'question', open: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface ConformanceHarness {
  /** Starts a daemon with data (at least one session). `replayWindow` is the SSE ring size. */
  start(options: { replayWindow: number }): Promise<ConformanceTarget>;
}

type Definition = keyof typeof schema.$defs;

function conforms(reply: Reply, name: Definition, status = 200): any {
  assert.equal(reply.status, status, reply.text);
  assert.match(String(reply.headers['content-type']), /^application\/json/);
  validate(reply.body, schema.$defs[name], schema);
  return reply.body;
}

function routes(harness: ConformanceHarness): void {
  describe('read routes', () => {
    let target: ConformanceTarget;
    let bearer: Record<string, string>;
    const get = (path: string) => call(target.port, `/api/v1${path}`, { headers: bearer });
    before(async () => { target = await harness.start({ replayWindow: 10_000 }); bearer = { Authorization: `Bearer ${target.token}` }; });
    after(async () => { await target.close(); });

    test('every collection route returns its schema definition', async () => {
      const cases: [string, Definition][] = [
        ['/overview', 'overview'], ['/sessions', 'sessions'], ['/requests?filter=all', 'requests'], ['/requests?filter=unanswered', 'requests'],
        ['/requests?filter=interrupted', 'requests'], ['/questions', 'questions'], ['/messages', 'messages'], ['/jobs', 'jobs'],
        ['/needs-you', 'needsYou'], ['/graph', 'graph'], ['/health', 'health'], ['/settings', 'settings'],
      ];
      for (const [path, name] of cases) conforms(await get(path), name);
    });

    test('lists are complete without limit; limit pages walk the same rows in order, ascending and descending', async () => {
      const pageNames = { sessions: 'sessionPage', requests: 'requestPage', questions: 'questionPage', messages: 'messagePage', jobs: 'jobPage' } as const;
      for (const [name, definition] of Object.entries(pageNames)) {
        const complete = conforms(await get(`/${name}`), name).items.map((item: any) => item.id);
        const walked: string[] = [];
        for (let after = ''; ;) {
          const page = conforms(await get(`/${name}?limit=3${after}`), definition);
          assert.equal(page.total, complete.length, name);
          walked.push(...page.items.map((item: any) => item.id));
          if (!page.hasMore) { assert.equal(page.nextCursor, null); break; }
          after = `&after=${page.nextCursor}`;
        }
        assert.deepEqual([...walked].sort(), [...complete].sort(), name);
        const descending = conforms(await get(`/${name}?limit=1000&order=desc`), definition).items.map((item: any) => item.id);
        assert.deepEqual(descending, [...walked].reverse(), name);
      }
      for (const query of ['limit=0', 'limit=1001', 'limit=x', 'limit=2&order=up', 'limit=2&after=garbage']) conforms(await get(`/jobs?${query}`), 'error', 400);
    });

    test('session detail and transcript pages conform; unknown ids are 404', async () => {
      const sessions = conforms(await get('/sessions'), 'sessions');
      assert.ok(sessions.items.length > 0, 'the harness seeds at least one session');
      const id = encodeURIComponent(sessions.items[0].id);
      assert.equal(conforms(await get(`/sessions/${id}`), 'sessionDetail').session.id, sessions.items[0].id);
      const page = conforms(await get(`/sessions/${id}/transcript?after=0&limit=5`), 'transcript');
      assert.ok(page.items.length <= 5);
      conforms(await get('/sessions/no-such-session'), 'error', 404);
      conforms(await get(`/sessions/${id}/transcript?around=no-such-entry`), 'error', 404);
    });

    test('invalid parameters are 400, unknown paths 404, other methods 405', async () => {
      conforms(await get('/requests?filter=bogus'), 'error', 400);
      const id = encodeURIComponent(conforms(await get('/sessions'), 'sessions').items[0].id);
      for (const query of ['limit=0', 'limit=1001', 'after=-1', 'after=1.5', 'limit=x']) {
        conforms(await get(`/sessions/${id}/transcript?${query}`), 'error', 400);
      }
      conforms(await get('/nothing-here'), 'error', 404);
      conforms(await call(target.port, '/api/v1/overview', { method: 'DELETE', headers: bearer }), 'error', 405);
    });

    test('responses are not cacheable and not sniffable', async () => {
      const reply = await get('/overview');
      assert.equal(reply.headers['cache-control'], 'no-store');
      assert.equal(reply.headers['x-content-type-options'], 'nosniff');
    });
  });
}

function security(harness: ConformanceHarness): void {
  describe('security boundary', () => {
    let target: ConformanceTarget;
    let origin: string;
    const overview = (headers: Record<string, string>) => call(target.port, '/api/v1/overview', { headers });
    before(async () => { target = await harness.start({ replayWindow: 10_000 }); origin = `http://127.0.0.1:${target.port}`; });
    after(async () => { await target.close(); });

    test('binds the loopback address only', () => {
      assert.equal(target.address, '127.0.0.1');
    });

    test('missing or wrong credentials are 401', async () => {
      conforms(await overview({}), 'error', 401);
      conforms(await overview({ Authorization: `Bearer ${'0'.repeat(64)}` }), 'error', 401);
      conforms(await overview({ Authorization: target.token }), 'error', 401);
      conforms(await overview({ Cookie: `piConsoleToken=${'0'.repeat(64)}` }), 'error', 401);
    });

    test('foreign Host, foreign Origin and cross-site fetches are 403 even with a valid token', async () => {
      const bearer = `Bearer ${target.token}`;
      conforms(await overview({ Authorization: bearer, Host: `evil.example:${target.port}` }), 'error', 403);
      conforms(await overview({ Authorization: bearer, Host: `127.0.0.1:${target.port + 1}` }), 'error', 403);
      conforms(await overview({ Authorization: bearer, Origin: 'http://evil.example' }), 'error', 403);
      conforms(await overview({ Authorization: bearer, Origin: 'null' }), 'error', 403);
      conforms(await overview({ Authorization: bearer, 'Sec-Fetch-Site': 'cross-site' }), 'error', 403);
      conforms(await overview({ Authorization: bearer, Host: `localhost:${target.port}`, Origin: `http://localhost:${target.port}` }), 'overview');
    });

    test('token exchange sets an HttpOnly SameSite=Strict API cookie and strips the token from the URL', async () => {
      const reply = await call(target.port, `/api/v1/overview?token=${target.token}&x=1`);
      assert.equal(reply.status, 303);
      assert.equal(reply.headers.location, '/api/v1/overview?x=1');
      const cookie = String(reply.headers['set-cookie']);
      for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/api/v1']) assert.ok(cookie.includes(part), part);
      assert.equal(reply.text.includes(target.token), false);
      conforms(await call(target.port, `/api/v1/overview?token=${'0'.repeat(64)}`), 'error', 401);
    });

    test('the cookie authenticates browser reads, but never a stream without Origin', async () => {
      const cookie = `piConsoleToken=${target.token}`;
      conforms(await overview({ Cookie: cookie, Origin: origin }), 'overview');
      const withoutOrigin = await openStream(target.port, { Cookie: cookie });
      assert.equal(withoutOrigin.status, 403);
      const foreign = await openStream(target.port, { Cookie: cookie, Origin: 'http://evil.example' });
      assert.equal(foreign.status, 403);
      const browser = await openStream(target.port, { Cookie: cookie, Origin: origin });
      assert.equal(browser.status, 200);
      browser.close();
    });
  });
}

function sse(harness: ConformanceHarness): void {
  describe('SSE snapshot, deltas and resume', () => {
    let target: ConformanceTarget | undefined;
    const start = async (replayWindow: number) => { target = await harness.start({ replayWindow }); return target; };
    const bearer = (t: ConformanceTarget, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t.token}`, ...extra });
    after(async () => { await target?.close(); });

    test('a new connection gets a snapshot at the current id, then contiguous deltas', async () => {
      const t = await start(10_000);
      const stream = await openStream(t.port, bearer(t));
      assert.equal(stream.status, 200);
      assert.match(String(stream.headers['content-type']), /^text\/event-stream/);
      const snapshot = await stream.next();
      assert.equal(snapshot.event, 'snapshot');
      assert.equal(snapshot.id, String(snapshot.data.seq));
      validate(snapshot.data, schema.$defs.event, schema);
      assert.ok(Buffer.byteLength(JSON.stringify(snapshot.data)) < 256 * 1024, 'the snapshot is a bounded screen state');
      const { totals, bounded = [] } = snapshot.data.payload;
      for (const name of ['sessions', 'requests', 'questions', 'messages', 'jobs'] as const) {
        assert.ok(snapshot.data.payload[name].length <= totals[name], name);
        if (!bounded.includes(name)) assert.equal(snapshot.data.payload[name].length, totals[name], name);
      }
      await t.emit();
      await t.emit();
      const first = await stream.next();
      const second = await stream.next();
      validate(first.data, schema.$defs.event, schema);
      assert.deepEqual([Number(first.id), Number(second.id)], [snapshot.data.seq + 1, snapshot.data.seq + 2]);
      stream.close();
      await t.close();
      target = undefined;
    });

    test('Last-Event-ID inside the window replays the missed deltas without a snapshot', async () => {
      const t = await start(10_000);
      const first = await openStream(t.port, bearer(t));
      const snapshot = await first.next();
      first.close();
      await t.emit();
      await t.emit();
      const resumed = await openStream(t.port, bearer(t, { 'Last-Event-ID': String(snapshot.data.seq) }));
      const replay = [await resumed.next(), await resumed.next()];
      assert.deepEqual(replay.map(frame => Number(frame.id)), [snapshot.data.seq + 1, snapshot.data.seq + 2]);
      assert.ok(replay.every(frame => frame.event !== 'snapshot'));
      resumed.close();
      const current = await openStream(t.port, bearer(t, { 'Last-Event-ID': String(snapshot.data.seq + 2) }));
      await t.emit();
      assert.equal(Number((await current.next()).id), snapshot.data.seq + 3);
      current.close();
      await t.close();
      target = undefined;
    });

    test('entity deltas update derived sessions and resume in the middle of a multi-update event', async () => {
      const t = await start(10_000);
      let stream = await openStream(t.port, bearer(t));
      let seq = Number((await stream.next()).id);
      for (const kind of ['request', 'question'] as const) {
        for (const open of [true, false]) {
          await t.emitAttention(kind, open);
          const entity = await stream.next();
          assert.equal(entity.event, kind === 'request' ? 'request.observed' : 'question.asked');
          assert.equal(Number(entity.id), seq + 1);
          assert.ok(entity.id);
          validate(entity.data, schema.$defs.event, schema);
          stream.close();
          stream = await openStream(t.port, bearer(t, { 'Last-Event-ID': entity.id }));
          const session = await stream.next();
          assert.equal(session.event, 'session.updated');
          assert.equal(Number(session.id), seq + 2);
          assert.equal(session.data.payload.id, t.attentionSessionId);
          assert.equal(session.data.payload.status, open ? 'needs-you' : 'idle');
          validate(session.data, schema.$defs.event, schema);
          seq += 2;
        }
      }
      await assert.rejects(stream.next(100));
      stream.close();
      await t.close();
      target = undefined;
    });

    test('an id older than the window gets a fresh snapshot; invalid or future ids are 400', async () => {
      const t = await start(2);
      const first = await openStream(t.port, bearer(t));
      const snapshot = await first.next();
      first.close();
      for (let i = 0; i < 3; i++) await t.emit();
      const stale = await openStream(t.port, bearer(t, { 'Last-Event-ID': String(snapshot.data.seq) }));
      const fresh = await stale.next();
      assert.equal(fresh.event, 'snapshot');
      assert.equal(Number(fresh.id), snapshot.data.seq + 3);
      stale.close();
      for (const id of ['abc', '-1', '1.5', String(snapshot.data.seq + 4), '99999999999999999999']) {
        const rejected = await openStream(t.port, bearer(t, { 'Last-Event-ID': id }));
        assert.equal(rejected.status, 400, id);
        validate(rejected.body, schema.$defs.error, schema);
      }
      await t.close();
      target = undefined;
    });
  });
}

/** Registers the shared suite under `describe(name)`. */
export function daemonConformance(name: string, harness: ConformanceHarness): void {
  describe(`API v1 conformance: ${name}`, () => {
    routes(harness);
    security(harness);
    sse(harness);
  });
}
