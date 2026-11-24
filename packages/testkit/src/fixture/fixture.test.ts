import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generate, observedAt, writeFixture } from './generate.ts';
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

test('lane IDs are unique to one repository and the recording replays the same identities', () => {
  const { fixture, timeline } = generate();
  const owners = new Map<string, Set<string>>();
  for (const session of fixture.sessions) owners.set(session.laneId, (owners.get(session.laneId) ?? new Set()).add(session.repositoryId));
  assert.equal(owners.size, 30);
  for (const [lane, repositories] of owners) assert.equal(repositories.size, 1, `${lane} belongs to one repository`);
  assert.deepEqual(fixture.sessions.slice(0, 5).map(session => session.laneId), ['L0', 'L192', 'L193', 'L194', 'L195']);
  assert.deepEqual(fixture.sessions.slice(5, 10).map(session => session.laneId), ['L196', 'L197', 'L198', 'L199', 'L200']);
  for (const event of timeline.filter(candidate => candidate.type === 'session.updated')) {
    const session = fixture.sessions.find(candidate => candidate.id === (event.payload as { id: string }).id);
    assert.equal((event.payload as { laneId: string }).laneId, session?.laneId);
  }
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

const { fixture: f } = generate();
const observed = Date.parse(f.generatedAt);
const distinct = (values: readonly unknown[]) => new Set(values).size;
const ageBucket = (updatedAt: string) => {
  const age = (observed - Date.parse(updatedAt)) / 1000;
  if (age < 60) return 'seconds';
  return age < 3600 ? 'minutes' : 'hours';
};

test('requests, questions and options are distinct, and models and costs vary', () => {
  assert.equal(f.generatedAt, observedAt);
  assert.equal(distinct(f.requests.map(request => request.text)), 12);
  assert.equal(distinct(f.questions.map(question => question.text)), 8);
  assert.ok(f.questions.every(question => question.options.length >= 2 && question.options.every(option => option.length > 0)));
  assert.ok(distinct(f.sessions.map(session => session.model)) >= 3);
});

test('session costs are distinct and positive, with deliberate unknown, known-zero and incomplete cases', () => {
  const costs = f.sessions.map(session => session.costUsd);
  assert.ok(distinct(costs.filter(cost => cost !== null && cost > 0)) >= 8);
  assert.ok(costs.includes(null) && costs.includes(0));
  assert.ok(f.sessions.some(session => session.costIncomplete));
});

test('sessions span seconds, minutes and hours of activity, never after observation', () => {
  assert.deepEqual([...new Set(f.sessions.map(session => ageBucket(session.updatedAt)))].sort(), ['hours', 'minutes', 'seconds']);
  assert.ok(f.sessions.every(session => Date.parse(session.updatedAt) <= observed));
});

const owners = new Map(f.sessions.map(session => [session.id, session]));
const inLifetime = (id: string, at: string) => Date.parse(at) >= Date.parse(owners.get(id)!.startedAt) && Date.parse(at) <= Date.parse(owners.get(id)!.updatedAt);

test('every entity time falls inside its owning session lifetime and answers follow prompts', () => {
  const samples = f.sessions.flatMap(session => session.samples.map(sample => [session.id, sample.at] as const));
  const entities: (readonly [string, string])[] = [
    ...samples, ...f.requests.map(request => [request.sessionId, request.createdAt] as const),
    ...f.questions.map(question => [question.sessionId, question.createdAt] as const), ...f.jobs.map(job => [job.sessionId, job.startedAt] as const),
    ...f.messages.flatMap(message => [[message.fromSessionId, message.sentAt], [message.toSessionId, message.sentAt]] as const), ...f.transcript.map(entry => ['s2', entry.at] as const),
  ];
  assert.deepEqual(entities.filter(([id, at]) => !inLifetime(id, at)), []);
  assert.ok(f.requests.every(request => !request.answer || Date.parse(request.answer.at) > Date.parse(request.createdAt)));
});

test('session samples ascend and the reset still maps to the first sample of s2', () => {
  for (const session of f.sessions) assert.deepEqual(session.samples.map(sample => sample.at), session.samples.map(sample => sample.at).sort());
  const [first, second] = f.sessions[1].samples;
  assert.equal(Date.parse(f.resets[0].at) - Date.parse(first.at), 18000);
  assert.ok(Date.parse(second.at) > Date.parse(f.resets[0].at));
});

test('transcript head, reset vicinity and tail have distinct prompts and answers per turn', () => {
  assert.equal(f.transcript[0].text, f.requests[0].text);
  assert.equal(f.transcript[100].kind, 'reset');
  for (const window of [f.transcript.slice(0, 40), f.transcript.slice(80, 120), f.transcript.slice(-40)]) {
    for (const kind of ['user', 'assistant']) {
      const texts = window.filter(entry => entry.kind === kind).map(entry => entry.text);
      assert.equal(distinct(texts), texts.length, `distinct ${kind} text`);
    }
  }
  assert.ok(distinct(f.transcript.map(entry => entry.text)) > 500, 'not a handful of repeated sentences');
});

const toolOf = (entry: (typeof f.transcript)[number]) => [entry.toolResult?.toolName, entry.toolResult?.argsExcerpt];

test('each tool call is followed by a result for the same tool and path; errors and truncation survive', () => {
  const calls = Map.groupBy(f.transcript.filter(item => item.toolCallId && item.kind !== 'reset'), item => item.toolCallId!);
  const pairs = [...calls.values()].filter(group => group.length === 2); // call12's call entry is the reset marker, as before
  for (const [call, result] of pairs) {
    assert.deepEqual([call.kind, result.kind], ['tool.call', 'tool.result']);
    assert.deepEqual(toolOf(call), toolOf(result));
    assert.equal(call.text, `read ${call.toolResult?.argsExcerpt}`);
  }
  const results = f.transcript.filter(entry => entry.kind === 'tool.result');
  assert.ok(results.some(entry => entry.toolResult?.resultKind === 'error'));
  assert.ok(results.some(entry => entry.toolResult?.truncated));
});
