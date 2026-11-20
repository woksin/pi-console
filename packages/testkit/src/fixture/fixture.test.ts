import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generate, writeFixture } from './generate.ts';
import { apiV1Schema as schema, eventPayloads, validate } from '@pi-console/contract';

const cache = tmpdir();
test('two generated recordings are byte-identical to the committed fixture', () => {
  const first = mkdtempSync(resolve(cache, 'pi-console-fixture-a-'));
  const second = mkdtempSync(resolve(cache, 'pi-console-fixture-b-'));
  writeFixture(first);
  writeFixture(second);
  for (const name of ['fixture.json', 'stream.jsonl']) {
    const bytes = readFileSync(resolve(first, name));
    assert.deepEqual(bytes, readFileSync(resolve(second, name)));
    assert.deepEqual(bytes, readFileSync(new URL(`./data/${name}`, import.meta.url)));
  }
  assert.notDeepEqual(generate(192), generate(193));
});

test('fixture has linked fleet, provenance, handoff, work, graph and transcript data', () => {
  const { fixture: f, timeline } = generate();
  assert.equal(f.sessions.length, 30);
  assert.equal(f.repositories.length, 6);
  assert.equal(new Set(f.sessions.map(session => session.status)).size, 7);
  assert.equal(f.transcript.length, 2000);
  assert.equal(f.messages.length, 40);
  assert.equal(f.questions.length, 8);
  const ids = new Set(f.sessions.map(session => session.id));
  for (const session of f.sessions) {
    assert.equal(session.samples.length, 24);
    if (session.parentSessionId) assert.ok(ids.has(session.parentSessionId));
  }
  for (const message of f.messages) {
    assert.ok(ids.has(message.fromSessionId));
    assert.ok(ids.has(message.toSessionId));
    assert.notEqual(message.fromSessionId, message.toSessionId);
  }
  assert.deepEqual(new Set(f.requests.map(request => request.origin)), new Set(['human', 'launch', 'unproven']));
  const interrupted = f.requests.find(request => request.id === 'r1')!;
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.answer, null);
  assert.equal(interrupted.interimAnswers.length, 1);
  assert.ok(f.resets[0].carriedRequestIds.includes(interrupted.id));
  for (const [i, event] of timeline.entries()) {
    if (i) assert.ok(event.t >= timeline[i - 1].t);
    validate({ seq: i + 1, type: event.type, occurredAt: f.generatedAt, payload: event.payload }, schema.$defs.event, schema);
  }
  assert.deepEqual(new Set(timeline.map(event => event.type)), new Set(Object.keys(eventPayloads).filter(type => !['snapshot', 'intervention.recorded'].includes(type))));
});

test('schema validator rejects malformed types, timestamps, enums and extra fields', () => {
  const session = generate().fixture.sessions[0];
  for (const malformed of [{ ...session, status: 'unknown' }, { ...session, startedAt: 'yesterday' }, { ...session, extra: true }, { ...session, contextPercent: 101 }, { ...session, id: 1 }]) {
    assert.throws(() => validate(malformed, schema.$defs.session, schema));
  }
  assert.throws(() => validate({}, schema.$defs.session, schema));
  const input = JSON.parse(readFileSync(new URL('../../../../docs/api/schemas/intervention-input.json', import.meta.url), 'utf8'));
  validate({ type: 'steer', sessionId: 's2', text: 'Check the queue.' }, input, schema);
  assert.throws(() => validate({ type: 'pause', sessionId: 's2' }, input, schema));
});
