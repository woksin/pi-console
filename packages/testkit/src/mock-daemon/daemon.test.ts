import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { request } from 'node:http';
import { startDaemon } from './server.ts';
import { apiV1Schema as schema, eventPayloads, validate } from '@pi-console/contract';

let daemon: Awaited<ReturnType<typeof startDaemon>>;
let base: string;
let authorization: string;
let directory: string;
before(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'pi-console-daemon-'));
  daemon = await startDaemon({ port: 0, speed: 100, dataDirectory: directory });
  base = `http://127.0.0.1:${daemon.port}`;
  authorization = `Bearer ${daemon.token}`;
});
after(async () => { await daemon?.close(); });
function api(path: string, init: RequestInit = {}) {
  return fetch(base + '/api/v1' + path, { ...init, headers: { authorization, ...(init.headers as Record<string, string> | undefined) } });
}
async function conform(response: Response, name: keyof typeof schema.$defs, status = 200) {
  assert.equal(response.status, status);
  const body = await response.json();
  validate(body, schema.$defs[name], schema);
  return body;
}
async function stream(lastId?: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const response = await api('/stream', { headers: lastId === undefined ? {} : { 'Last-Event-ID': String(lastId) }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next() {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith(':')) continue;
          const lines = frame.split('\n');
          const event = JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6));
          assert.equal(Number(lines.find(line => line.startsWith('id: '))!.slice(4)), event.seq);
          assert.equal(lines.find(line => line.startsWith('event: '))!.slice(7), event.type);
          validate(event, schema.$defs.event, schema);
          return event;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Unexpected end of SSE');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    async close() { clearTimeout(timeout); await reader.cancel(); controller.abort(); },
  };
}

test('every GET endpoint conforms, with filtering and transcript cursor pagination', async () => {
  for (const [path, name] of [
    ['/overview', 'overview'], ['/needs-you', 'needsYou'], ['/sessions', 'sessions'], ['/sessions/s2', 'sessionDetail'],
    ['/sessions/s2/transcript', 'transcript'], ['/requests', 'requests'],
    ['/requests?filter=all', 'requests'], ['/requests?filter=unanswered', 'requests'],
    ['/requests?filter=interrupted', 'requests'], ['/questions', 'questions'], ['/messages', 'messages'], ['/jobs', 'jobs'],
  ] as const) await conform(await api(path), name);
  const first = await conform(await api('/sessions/s2/transcript?limit=2'), 'transcript');
  assert.equal(first.items.length, 2);
  const next = await conform(await api(`/sessions/s2/transcript?after=${first.nextCursor}&limit=2`), 'transcript');
  assert.ok(next.items[0].cursor > first.nextCursor);
  assert.equal((await conform(await api('/sessions/s1/transcript'), 'transcript')).items.length, 0);
  const interrupted = await conform(await api('/requests?filter=interrupted'), 'requests');
  assert.ok(interrupted.items.every((item: { status: string }) => item.status === 'interrupted'));
  for (const path of ['/requests?filter=bad', '/sessions/s2/transcript?after=-1', '/sessions/s2/transcript?limit=0', '/sessions/s2/transcript?limit=1001', '/stream']) {
    if (path === '/stream') await conform(await api(path, { headers: { 'Last-Event-ID': 'invalid' } }), 'error', 400);
    else await conform(await api(path), 'error', 400);
  }
  await conform(await api('/sessions/missing'), 'error', 404);
  await conform(await api('/missing'), 'error', 404);
  await conform(await api('/overview', { method: 'DELETE' }), 'error', 405);
});

test('authentication rejects missing credentials, foreign Host and unsafe browser requests', async () => {
  await conform(await fetch(base + '/api/v1/overview'), 'error', 401);
  await conform(await api('/overview', { headers: { authorization: 'Bearer bad' } }), 'error', 401);
  const hostStatus = await new Promise<number>(resolveStatus => {
    const req = request(base + '/api/v1/overview', { headers: { host: 'evil.invalid', authorization } }, res => { res.resume(); resolveStatus(res.statusCode!); });
    req.end();
  });
  assert.equal(hostStatus, 403);
  for (const [path, method] of [['/interventions', 'POST'], ['/stream', 'GET']] as const) {
    await conform(await api(path, { method, headers: { origin: 'http://evil.invalid' } }), 'error', 403);
    await conform(await api(path, { method, headers: { 'Sec-Fetch-Site': 'cross-site' } }), 'error', 403);
  }
  assert.equal(statSync(resolve(directory, 'token')).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
});

test('query login redirects without token; cookie SSE and POST need origin and CSRF', async () => {
  const login = await fetch(`${base}/api/v1/overview?token=${daemon.token}`, { redirect: 'manual' });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/api/v1/overview');
  const setCookie = login.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  await conform(await fetch(base + '/api/v1/overview', { headers: { cookie } }), 'overview');
  await conform(await fetch(base + '/api/v1/stream', { headers: { cookie } }), 'error', 403);
  const body = JSON.stringify({ type: 'steer', sessionId: 's2', text: 'Check the synthetic queue.' });
  for (const headers of [{ cookie }, { cookie, origin: base }] as Record<string, string>[]) {
    await conform(await fetch(base + '/api/v1/interventions', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body }), 'error', 403);
  }
  await conform(await fetch(base + '/api/v1/interventions', { method: 'POST', headers: { cookie, origin: base, 'x-pi-console-csrf': '1', 'content-type': 'application/json' }, body }), 'intervention', 202);
  const controller = new AbortController();
  const sse = await fetch(base + '/api/v1/stream', { headers: { cookie, origin: base }, signal: controller.signal });
  assert.equal(sse.status, 200);
  await sse.body?.cancel();
  controller.abort();
});

test('all intervention variants echo a mock-only audit and stream it without delivery', async () => {
  for (const type of ['answer', 'steer', 'followUp', 'nextTurn', 'abort']) {
    const body = { type, sessionId: 's2', text: 'Preserve the checkpoint.', ...(type === 'answer' ? { questionId: 'q2' } : {}), ...(type === 'abort' ? { confirmation: 'L192' } : {}) };
    const record = await conform(await api('/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), 'intervention', 202);
    assert.equal(record.type, type);
    assert.equal(record.result, 'mock-only');
    assert.equal(daemon.store.fixture.sessions.find(session => session.id === 's2')!.id, 's2');
  }
  for (const input of [{ type: 'pause', sessionId: 's2' }, { type: 'abort', sessionId: 's2' }, { type: 'steer', sessionId: 's2' }, { type: 'answer', sessionId: 's2', text: 'Yes' }, null]) {
    await conform(await api('/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }), 'error', 400);
  }
  await conform(await api('/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), 'error', 400);
  await conform(await api('/interventions', { method: 'POST', body: '{}' }), 'error', 415);
  await conform(await api('/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'steer', sessionId: 's2', text: 'x'.repeat(70000) }) }), 'error', 413);
});

test('SSE snapshot, every live event type, monotonic ids, and exact resume replay conform', async () => {
  const connection = await stream();
  try {
    const snapshot = await connection.next();
    assert.equal(snapshot.type, 'snapshot');
    const seen = new Set([snapshot.type]);
    const body = JSON.stringify({ type: 'steer', sessionId: 's2', text: 'Retain the fixture evidence.' });
    await api('/interventions', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    let previous = snapshot.seq;
    while (seen.size < Object.keys(eventPayloads).length) {
      const event = await connection.next();
      assert.equal(event.seq, previous + 1);
      previous = event.seq;
      seen.add(event.type);
    }
  } finally { await connection.close(); }
  const anchor = daemon.store.publish('session.updated', daemon.store.fixture.sessions[0]);
  const expected = daemon.store.publish('session.updated', daemon.store.fixture.sessions[1]);
  const resumed = await stream(anchor.seq);
  try { assert.deepEqual(await resumed.next(), expected); }
  finally { await resumed.close(); }
  await conform(await api('/stream', { headers: { 'Last-Event-ID': String(Number.MAX_SAFE_INTEGER) } }), 'error', 400);
});

test('API v1 gaps: needs-you reasons with transcript pointers, requestId on user entries, structured tool results', async () => {
  const { items } = await conform(await api('/needs-you'), 'needsYou');
  assert.deepEqual(new Set(items.map((item: { reason: string }) => item.reason)), new Set(['open-request', 'answer-possibly-unseen', 'blocking-question', 'lane-waiting-on-user', 'stale-session']));
  const unproven = new Set(daemon.store.fixture.requests.filter(r => r.origin === 'unproven').map(r => 'need-' + r.id));
  assert.ok(items.every((item: { id: string }) => !unproven.has(item.id)), 'unproven prompts raise no attention item');
  const pointed = items.find((item: { pointer: unknown }) => item.pointer);
  assert.ok(pointed, 'at least one item carries a transcript pointer');
  const entries = (await conform(await api('/sessions/s2/transcript?limit=1000'), 'transcript')).items;
  assert.ok(entries.some((entry: { id: string }) => entry.id === pointed.pointer.entryId));
  assert.ok(entries.filter((entry: { kind: string }) => entry.kind === 'user').every((entry: { requestId: string | null }) => entry.requestId));
  assert.ok(entries.filter((entry: { kind: string }) => entry.kind !== 'user').every((entry: { requestId: string | null }) => entry.requestId === null));
  const results = entries.filter((entry: { kind: string }) => entry.kind === 'tool.result');
  assert.ok(results.length > 0 && results.every((entry: { toolResult: { toolName: string } | null }) => entry.toolResult?.toolName === 'read'));
  assert.ok(results.some((entry: { toolResult: { truncated: boolean } }) => entry.toolResult.truncated));
});

test('stress rate appends cursor-addressable transcript entries', async () => {
  const stress = await startDaemon({ port: 0, rate: 5000, dataDirectory: directory });
  try {
    await new Promise(done => setTimeout(done, 150));
    const live = stress.store.fixture.transcript.filter(entry => entry.cursor > 2000);
    assert.ok(live.length >= 100);
    assert.ok(live.every((entry, i) => i === 0 || entry.cursor > live[i - 1].cursor));
  } finally { await stress.close(); }
});
