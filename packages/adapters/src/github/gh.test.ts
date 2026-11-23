import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeSpawn } from './fake-gh.ts';
import { ghArguments, lookupTarget, query } from './gh-query.ts';
import { ghEnvironment, runGh } from './gh-process.ts';
import { observationEvent } from './observation-event.ts';

const target = { owner: 'a', repo: 'b', number: 7 };
const reply = (item: object | null, extra: object = {}) => JSON.stringify({ data: { repository: item === null ? null : { issueOrPullRequest: item }, rateLimit: { remaining: 4000, resetAt: '2026-01-01T01:00:00Z' } }, ...extra });
const issue = (state: string, closedAt: string | null) => ({ __typename: 'Issue', number: 7, closedAt, issueState: state });
const pull = (state: string, closedAt: string | null, mergedAt: string | null) => ({ __typename: 'PullRequest', number: 7, closedAt, mergedAt, prState: state });
const fast = { timeoutMs: 40, graceMs: 20, killWaitMs: 20 };
const closedAt = '2026-01-01T00:00:00Z';

test('argv is a fixed array with separate variables, no shell, and nothing option-like can be injected', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: reply(issue('CLOSED', closedAt)) });
  await lookupTarget({ owner: 'o', repo: 'r', number: 3 }, { spawn });
  assert.equal(calls[0].command, 'gh');
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`, '-f', 'owner=o', '-f', 'name=r', '-F', 'number=3']);
  assert.deepEqual(calls[0].options, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: calls[0].options && (calls[0].options as { env: object }).env, windowsHide: true });
  assert.ok(!query.includes('mutation') && !query.includes('body') && !query.includes('title'));
  assert.ok(ghArguments(target).every(argument => typeof argument === 'string'));
});

test('the environment disables prompts, paging, colour and debug output', () => {
  const env = ghEnvironment({ GH_DEBUG: 'api', DEBUG: '*', GH_TOKEN: 'ghp_keepme', GH_HOST: 'evil.example', PATH: '/bin' });
  assert.deepEqual([env.GH_DEBUG, env.DEBUG, env.GH_HOST, env.GH_PROMPT_DISABLED, env.NO_COLOR, env.GH_TOKEN, env.PATH], [undefined, undefined, undefined, '1', '1', 'ghp_keepme', '/bin']);
});

test('issues, merged and unmerged-closed pull requests are observed with their real closedAt', async () => {
  const cases: [object, string, string, string | null][] = [
    [issue('OPEN', null), 'issue', 'open', null], [issue('CLOSED', closedAt), 'issue', 'closed', closedAt],
    [pull('MERGED', closedAt, closedAt), 'pull-request', 'merged', closedAt], [pull('CLOSED', closedAt, null), 'pull-request', 'closed', closedAt], [pull('OPEN', null, null), 'pull-request', 'open', null],
  ];
  for (const [item, kind, state, at] of cases) {
    const result = await lookupTarget(target, { spawn: fakeSpawn({ stdout: reply(item) }).spawn });
    assert.deepEqual(result, { ok: true, kind, state, closedAt: at, resumeAt: null });
  }
});

test('anything partial, mismatched or inconsistent is invalid and never a closure', async () => {
  const bad = [
    reply(null), reply({ __typename: 'Issue', number: 8, closedAt, issueState: 'CLOSED' }), reply(issue('CLOSED', null)), reply(issue('OPEN', closedAt)), reply(issue('WEIRD', closedAt)),
    reply(issue('CLOSED', 'yesterday')), reply(pull('MERGED', closedAt, null)), reply(pull('CLOSED', closedAt, closedAt)), reply({ __typename: 'Repository', number: 7 }),
    reply(issue('CLOSED', closedAt), { errors: [{ message: 'partial' }] }), '{"data":null}', 'not json', '[]', '', JSON.stringify({ data: { repository: { issueOrPullRequest: [] } } }),
  ];
  for (const stdout of bad) {
    const result = await lookupTarget(target, { spawn: fakeSpawn({ stdout }).spawn });
    assert.equal(result.ok, false, stdout.slice(0, 60));
  }
});

test('missing, unauthenticated, offline and rate-limited gh are safe categories without text', async () => {
  const run = (behaviour: Parameters<typeof fakeSpawn>[0]) => lookupTarget(target, { spawn: fakeSpawn(behaviour).spawn });
  assert.deepEqual(await run({ error: true }), { ok: false, failure: 'unavailable', resumeAt: null });
  assert.deepEqual(await run({ code: 4, stderr: 'gh: To get started with GitHub CLI, please run: gh auth login ghp_abcdefghijkl' }), { ok: false, failure: 'unavailable', resumeAt: null });
  assert.deepEqual(await run({ code: 1, stderr: 'dial tcp: lookup api.github.com: no such host' }), { ok: false, failure: 'unavailable', resumeAt: null });
  assert.deepEqual(await run({ code: 1, stderr: 'gh: API rate limit exceeded (HTTP 403)' }), { ok: false, failure: 'rate-limited', resumeAt: null });
  const resets = JSON.stringify({ errors: [{ type: 'RATE_LIMITED' }], data: { rateLimit: { remaining: 0, resetAt: '2026-01-01T05:00:00Z' } } });
  assert.deepEqual(await run({ code: 0, stdout: resets }), { ok: false, failure: 'rate-limited', resumeAt: '2026-01-01T05:00:00Z' });
  const exposed = JSON.stringify(await run({ code: 1, stderr: 'token ghp_abcdefghijkl leaked' }));
  assert.ok(!exposed.includes('ghp_'));
});

test('output over the bound is cut off and invalid, never parsed', async () => {
  const { spawn, calls } = fakeSpawn({ stdout: 'x'.repeat(40 * 1024), ignoreTerm: false, hang: true });
  const result = await lookupTarget(target, { spawn, limits: fast });
  assert.deepEqual(result, { ok: false, failure: 'invalid', resumeAt: null });
  assert.ok(calls[0].signals.includes('SIGTERM'));
  const noisy = await runGh(['x'], { spawn: fakeSpawn({ stderr: 'e'.repeat(5000), hang: true }).spawn, limits: fast });
  assert.equal(noisy.end, 'overflow');
});

test('a hanging child is terminated at the timeout; one that ignores TERM is killed after the grace; shutdown stays bounded', async () => {
  const hung = fakeSpawn({ hang: true });
  const started = Date.now();
  assert.equal((await runGh(['x'], { spawn: hung.spawn, limits: fast })).end, 'timeout');
  assert.deepEqual(hung.calls[0].signals, ['SIGTERM']);
  const stubborn = fakeSpawn({ ignoreTerm: true });
  const result = await runGh(['x'], { spawn: stubborn.spawn, limits: fast });
  assert.equal(result.end, 'timeout');
  assert.deepEqual(stubborn.calls[0].signals, ['SIGTERM', 'SIGKILL']);
  const unkillable = fakeSpawn({ unkillable: true });
  assert.equal((await runGh(['x'], { spawn: unkillable.spawn, limits: fast })).end, 'timeout');
  assert.deepEqual(unkillable.calls[0].signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(Date.now() - started < 1_000);
});

test('abort stops only the own child, escalates, and is bounded even when the child ignores everything', async () => {
  const controller = new AbortController();
  const stubborn = fakeSpawn({ unkillable: true });
  const pending = runGh(['x'], { spawn: stubborn.spawn, limits: { ...fast, timeoutMs: 60_000 }, signal: controller.signal });
  setTimeout(() => { controller.abort(); }, 5);
  assert.equal((await pending).end, 'aborted');
  assert.deepEqual(stubborn.calls[0].signals, ['SIGTERM', 'SIGKILL']);
  const early = new AbortController(); early.abort();
  assert.equal((await runGh(['x'], { spawn: fakeSpawn({ hang: true }).spawn, limits: fast, signal: early.signal })).end, 'aborted');
});

const fact = { questionId: 'q1', revision: 2, target: 'a/b#7', kind: 'issue' as const, state: 'closed' as const, closedAt, fetchedAt: '2026-01-01T02:00:00Z' };

test('observation events carry no file refs, a stable identity and the fetch time; re-emitting is the same idempotency key', () => {
  const first = observationEvent(fact)!, again = observationEvent(fact)!;
  assert.deepEqual([first.refs, first.occurredAt, first.source, first.subject], [null, fact.fetchedAt, 'github-closures', 'question:q1']);
  assert.equal(first.idempotencyKey, again.idempotencyKey);
  assert.notEqual(first.id, again.id);
  assert.notEqual(observationEvent({ ...fact, revision: 3 })!.idempotencyKey, first.idempotencyKey);
  assert.notEqual(observationEvent({ ...fact, fetchedAt: '2026-01-01T03:00:00Z' })!.idempotencyKey, first.idempotencyKey);
  assert.ok(!first.idempotencyKey.includes('q1'));
});

test('events that would be invalid or altered by redaction are refused, not recorded under another identity', () => {
  assert.equal(observationEvent({ ...fact, target: '--repo' }), null);
  assert.equal(observationEvent({ ...fact, fetchedAt: 'later' }), null);
  assert.equal(observationEvent({ ...fact, state: 'bogus' as never }), null);
  assert.equal(observationEvent({ ...fact, questionId: 'ghp_abcdefghijkl' }), null);
  assert.equal(observationEvent(fact, () => { throw new Error('scanner'); }), null);
});
