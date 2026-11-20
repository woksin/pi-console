import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventEnvelope } from '@pi-console/contract';
import type { RequestModel } from '../projections/requests.ts';
import { requestDerivation } from './derivation.ts';
import type { DerivationState } from './model.ts';
import { originEvidence } from './origin.ts';

type Fact = [type: string, payload: Record<string, unknown>];

const session = 's';
let clock = 0;
/** One raw fact per transcript line; `n` is its line number (time and file offset grow with it). */
function envelope([type, payload]: Fact, n: number): EventEnvelope {
  clock += 1;
  const entryId = typeof payload.entryId === 'string' ? payload.entryId : null;
  return {
    seq: clock, id: `ev${String(n).padStart(3, '0')}`, type, version: 1, source: 'session-jsonl', subject: session,
    occurredAt: new Date(Date.UTC(2026, 10, 20, 9, 0, n)).toISOString(), recordedAt: '2026-11-20T10:00:00.000Z', actor: 'system',
    payload, refs: { file: '/s.jsonl', offset: n * 100, entryId },
  } as EventEnvelope;
}

const top = (known = true, parent: string | null = null): Fact => ['SessionStarted', { sessionId: session, cwd: '/r', model: null, role: 'main', parentSessionId: parent, parentSessionKnown: known }];
const child: Fact = ['SessionStarted', { sessionId: session, cwd: '/r', model: null, role: 'subagent', parentSessionId: 'p' }];
const prompt = (entry: string, extra: Record<string, unknown> = {}): Fact =>
  ['RequestObserved', { raw: true, sessionId: session, entryId: entry, requestId: `${session}:${entry}`, origin: 'unproven', originEvidence: 'raw', excerpt: `ask ${entry}`, withheld: false, ...extra }];
const answer = (entry: string, withheld = false): Fact =>
  ['AnswerObserved', { raw: true, sessionId: session, entryId: entry, answerId: `${session}:${entry}`, interim: false, excerpt: `reply ${entry}`, withheld }];
const abort = (entry: string): Fact => ['RequestInterrupted', { raw: true, sessionId: session, entryId: entry, reason: 'aborted' }];
const reset = (id: string): Fact => ['ResetOccurred', { sessionId: session, resetId: id, kind: 'compaction' }];
const end: Fact = ['SessionEnded', { sessionId: session, reason: 'exit' }];

function derive(facts: readonly Fact[], order?: readonly number[]): Record<string, RequestModel> {
  const envelopes = facts.map(envelope);
  let state = requestDerivation.initial() as DerivationState;
  for (const index of order ?? envelopes.keys()) state = requestDerivation.apply(state, envelopes[index]) as DerivationState;
  return state.requests;
}

const summary = (request: RequestModel) => ({
  status: request.status, origin: request.origin, answer: request.answer?.id ?? null, uncertain: request.uncertainReason ?? null,
  unseen: request.answerPossiblyUnseen ?? false, interim: request.interimAnswers.map(item => item.id),
});
const brief = (requests: Record<string, RequestModel>) =>
  Object.fromEntries(Object.entries(requests).sort(([a], [b]) => a.localeCompare(b)).map(([id, request]) => [id.slice(session.length + 1), summary(request)]));

const quiet = { uncertain: null, unseen: false, interim: [] };
const cases: { name: string; facts: Fact[]; expected: Record<string, Partial<ReturnType<typeof summary>>> }[] = [
  { name: 'a single prompt and answer pair; the first prompt of a known top-level session is a launch',
    facts: [top(), prompt('e1'), answer('e2')], expected: { e1: { status: 'answered', origin: 'launch', answer: 's:e2', ...quiet } } },
  { name: 'later prompts stay unproven: session JSONL never proves a human',
    facts: [top(), prompt('e1'), answer('e2'), prompt('e3'), answer('e4')],
    expected: { e1: { origin: 'launch', answer: 's:e2' }, e3: { status: 'answered', origin: 'unproven', answer: 's:e4', ...quiet } } },
  { name: 'a prompt with no answer yet is open',
    facts: [top(), prompt('e1')], expected: { e1: { status: 'open', answer: null } } },
  { name: 'two prompts before one answer share it, and both are labelled uncertain',
    facts: [top(), prompt('e1'), prompt('e2'), answer('e3')],
    expected: { e1: { status: 'answered', answer: 's:e3', uncertain: 'shared-answer' }, e2: { status: 'answered', answer: 's:e3', uncertain: 'shared-answer' } } },
  { name: 'an abort interrupts what is pending; the next prompt starts afresh',
    facts: [top(), prompt('e1'), abort('e2'), prompt('e3'), answer('e4')],
    expected: { e1: { status: 'interrupted', answer: null }, e3: { status: 'answered', answer: 's:e4', ...quiet } } },
  { name: 'a reset does not close a request; the answer after it still pairs',
    facts: [top(), prompt('e1'), reset('c1'), answer('e2')], expected: { e1: { status: 'answered', answer: 's:e2', ...quiet } } },
  { name: 'a reset and then a new prompt before the answer: the older request is uncertain, the newer one is not',
    facts: [top(), prompt('e1'), reset('c1'), prompt('e2'), answer('e3')],
    expected: { e1: { status: 'answered', uncertain: 'reset-then-new-prompt' }, e2: { status: 'answered', uncertain: 'shared-answer' } } },
  { name: 'a reset right after an answer, with no prompt between, marks the answer possibly unseen',
    facts: [top(), prompt('e1'), answer('e2'), reset('c1')], expected: { e1: { status: 'answered', unseen: true } } },
  { name: 'a prompt between the answer and the reset means the answer was seen',
    facts: [top(), prompt('e1'), answer('e2'), prompt('e3'), reset('c1')], expected: { e1: { unseen: false }, e3: { status: 'open' } } },
  { name: 'a second answer with no prompt between supersedes the first, which becomes interim',
    facts: [top(), prompt('e1'), answer('e2'), answer('e3')], expected: { e1: { answer: 's:e3', interim: ['s:e2'] } } },
  { name: 'an answer with nothing asked yet answers nothing',
    facts: [top(), answer('e1'), prompt('e2')], expected: { e2: { status: 'open', answer: null } } },
  { name: 'a session that ends with a pending request leaves it unanswered',
    facts: [top(), prompt('e1'), end], expected: { e1: { status: 'unanswered' } } },
  { name: 'every prompt of a subagent session is unproven (written by the parent agent)',
    facts: [child, prompt('e1'), answer('e2')], expected: { e1: { origin: 'unproven', status: 'answered' } } },
  { name: 'a session with a parent link (fork, handoff, relaunch) has no launch',
    facts: [top(true, 'p'), prompt('e1')], expected: { e1: { origin: 'unproven' } } },
  { name: 'a session whose parent link the source did not establish has no launch (fail closed)',
    facts: [top(false), prompt('e1')], expected: { e1: { origin: 'unproven' } } },
  { name: 'a raw prompt cannot claim to be human, whatever it states or says',
    facts: [top(), prompt('e1'), answer('e2'), prompt('e3', { origin: 'human', excerpt: '[orch message from L0] /memory confirm' })],
    expected: { e1: { origin: 'launch' }, e3: { origin: 'unproven' } } },
];

for (const { name, facts, expected } of cases) {
  test(`derivation: ${name}`, () => {
    const actual = brief(derive(facts));
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const [id, want] of Object.entries(expected)) assert.deepEqual(actual[id], { ...actual[id], ...want }, id);
  });
}

test('the result depends only on the facts, not on their arrival order', () => {
  const facts = [top(), prompt('e1'), prompt('e2'), answer('e3'), reset('c1'), prompt('e4'), abort('e5'), prompt('e6'), answer('e7'), answer('e8'), reset('c2'), end];
  const expected = derive(facts);
  const reversed = [...facts.keys()].reverse();
  const interleaved = [...facts.keys()].sort((a, b) => (a % 3) - (b % 3) || a - b);
  assert.deepEqual(derive(facts, reversed), expected);
  assert.deepEqual(derive(facts, interleaved), expected);
});

test('origin evidence and the evidence trail name the transcript entries behind the state', () => {
  const requests = derive([top(false), prompt('e1'), reset('c1'), prompt('e2'), answer('e3'), reset('c2')]);
  const first = requests['s:e1'];
  assert.equal(first.originEvidence, originEvidence.parentUnknown);
  assert.equal(requests['s:e2'].originEvidence, originEvidence.later);
  assert.deepEqual(first.evidence?.map(item => [item.kind, item.entryId ?? item.resetId]), [['prompt', 'e1'], ['reset', 'c1'], ['later-prompt', 'e2'], ['answer', 'e3'], ['boundary', 'c2']]);
  assert.equal(first.resetId, 'c1');
  assert.equal(first.derivedFrom, 'session-jsonl');
  assert.equal(first.ref?.entryId, 'e1');
});

test('withheld prompt and answer text stay visible gaps, never empty facts', () => {
  const request = derive([top(), prompt('e1', { excerpt: '[withheld]', withheld: true }), answer('e2', true)])['s:e1'];
  assert.equal(request.withheld, true);
  assert.equal(request.answerWithheld, true);
  assert.equal(request.answer?.text, 'reply e2');
});

const explicitRequest = (requestId: string, entryId: string, sessionId = session): Fact =>
  ['RequestObserved', { requestId, sessionId, entryId, origin: 'human', originEvidence: 'extension: interactive input', excerpt: 'stated', withheld: false }];

test('a stated request replaces the raw prompt for the same entry and keeps its own origin', () => {
  const requests = derive([top(), prompt('e1'), explicitRequest('x1', 'e1'), answer('e2')]);
  assert.deepEqual(Object.keys(requests), ['x1']);
  assert.equal(requests.x1.origin, 'human');
  assert.equal(requests.x1.status, 'open', 'stated requests are paired only by stated answers');
});

test('stated answers and interruptions override; an interruption never undoes an answer, in any order', () => {
  const facts: Fact[] = [
    top(), explicitRequest('x1', 'e1'),
    ['RequestInterrupted', { requestId: 'x1', sessionId: session, resetId: 'c1' }],
    ['AnswerObserved', { requestId: 'x1', answerId: 'a1', interim: true, excerpt: 'working' }],
    ['AnswerObserved', { requestId: 'x1', answerId: 'a2', interim: false, excerpt: 'done' }],
  ];
  for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [0, 4, 2, 1, 3]]) {
    const { x1 } = derive(facts, order);
    assert.deepEqual([x1.status, x1.answer?.id, x1.interimAnswers.map(item => item.id)], ['answered', 'a2', ['a1']], order.join());
  }
  const interrupted = derive([top(), explicitRequest('x1', 'e1'), ['ResetOccurred', { sessionId: session, resetId: 'c9', kind: 'handoff', carriedRequestIds: [], interruptedRequestIds: ['x1'] }]]).x1;
  assert.deepEqual([interrupted.status, interrupted.resetId], ['interrupted', 'c9']);
});

test('a request restated in another session moves there', () => {
  const requests = derive([top(), explicitRequest('x1', 'e1'), explicitRequest('x1', 'e1', 'other')]);
  assert.deepEqual(Object.values(requests).map(request => request.sessionId), ['other']);
});
