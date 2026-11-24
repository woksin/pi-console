import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from '@pi-console/contract';
import { cycleRequestFilter, describeRequestFilter, requestDetail, requestFilterAction, requestsViewModel, singleLine, uncertainLabels } from './requests.ts';
import { fixture, golden, now } from '../test-support.ts';

const ESC = String.fromCharCode(27);
const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute)).toISOString();
const sessionId = fixture.sessions[0].id;
const base = (id: string, minute: number, extra: Partial<Request>): Request => ({
  id, sessionId, text: `ask ${id}`, origin: 'unproven', originLabel: 'Unproven origin', originEvidence: 'Later prompt', status: 'answered',
  createdAt: at(minute), resetId: null, answer: { id: `${id}-a`, text: `reply ${id}`, at: at(minute + 1), interim: false }, interimAnswers: [],
  withheld: false, answerWithheld: false, answerPossiblyUnseen: false, uncertain: false, uncertainReason: null, derivedFrom: 'session-jsonl',
  evidence: [{ kind: 'prompt', entryId: `${id}-e`, resetId: null, at: at(minute) }], pointer: { sessionId, entryId: `${id}-e`, fileOffset: minute * 100 },
  ...extra,
});

/** Derived requests covering every label, next to the fixture's plain API records. */
const derived: Request[] = [
  base('d1', 1, { origin: 'launch', originLabel: 'Initial prompt', originEvidence: 'First prompt of a session without a parent' }),
  base('d2', 2, { uncertain: true, uncertainReason: 'shared-answer' }),
  base('d3', 3, { uncertain: true, uncertainReason: 'reset-then-new-prompt', resetId: 'c1',
    evidence: [{ kind: 'prompt', entryId: 'd3-e', resetId: null, at: at(3) }, { kind: 'reset', entryId: null, resetId: 'c1', at: at(4) }] }),
  base('d4', 5, { answerPossiblyUnseen: true, interimAnswers: [{ id: 'd4-i', text: 'first try', at: at(6), interim: true }] }),
  base('d5', 7, { text: '[withheld]', withheld: true, status: 'open', answer: null }),
  base('d6', 8, { text: `## User directives\n[orch message from L0] do it${ESC}[31m`, status: 'interrupted', answer: null }),
];
const requests = [...fixture.requests, ...derived];
const model = (filter?: Parameters<typeof requestsViewModel>[0]['filter']) => requestsViewModel({ requests, sessions: fixture.sessions, now, filter });

test('golden: list, filters and a detail with evidence', () => {
  golden('requests', {
    all: model(), uncertain: model({ state: 'uncertain' }), launch: model({ origin: 'launch' }),
    detail: requestDetail({ request: derived[2], sessions: fixture.sessions, now }),
  });
});

test('filters by state, origin and session, and counts what needs attention', () => {
  assert.deepEqual(model({ state: 'possibly-unseen' }).rows.map(row => row.id), ['d4']);
  assert.deepEqual(model({ state: 'uncertain' }).rows.map(row => row.id), ['d3', 'd2']);
  assert.ok(model({ origin: 'launch' }).rows.every(row => row.origin === 'launch'));
  assert.ok(model({ sessionId }).rows.every(row => row.sessionId === sessionId));
  assert.deepEqual(model({ sessionId: 'nobody' }).rows, []);
  const all = model();
  assert.equal(all.rows.length, requests.length);
  assert.deepEqual([all.uncertain, all.possiblyUnseen], [2, 1]);
});

test('uncertain pairings and possibly unseen answers are always labelled', () => {
  const rows = new Map(model().rows.map(row => [row.id, row]));
  assert.equal(rows.get('d2')?.uncertain, uncertainLabels['shared-answer']);
  assert.equal(rows.get('d1')?.uncertain, null);
  assert.equal(rows.get('d4')?.possiblyUnseen?.label, 'Possibly unseen');
  assert.equal(rows.get('d1')?.transcript?.entryId, 'd1-e');
});

test('stored text is data: one line, no control sequences, withheld text a visible gap', () => {
  const rows = new Map(model().rows.map(row => [row.id, row]));
  assert.equal(rows.get('d6')?.text, '## User directives ⏎ [orch message from L0] do it');
  assert.ok(!rows.get('d6')?.text.includes('\n'));
  assert.equal(rows.get('d5')?.text, '[withheld]');
  assert.equal(rows.get('d5')?.withheld, true);
  assert.equal(singleLine(`a\r\nb${ESC}]0;title${String.fromCharCode(7)}`), 'a ⏎ b');
});

test('the detail gives a short inferred classification, never verified, and links every evidence entry to the transcript', () => {
  const detail = requestDetail({ request: derived[0], sessions: fixture.sessions, now });
  assert.equal(detail.provenance, 'Initial prompt · inferred from transcript');
  assert.equal(detail.provenanceQualifier, 'not verified');
  const human = requestDetail({ request: { ...derived[0], origin: 'human', originLabel: 'Human request' }, sessions: fixture.sessions, now });
  assert.equal(human.provenance, 'Human request · inferred from transcript');
  assert.equal(human.provenanceQualifier, 'not verified');
  const stored = requestDetail({ request: { ...derived[0], derivedFrom: 'intent-memory' }, sessions: fixture.sessions, now });
  assert.equal(stored.provenance, 'Initial prompt · reported by intent-memory');
  assert.deepEqual(detail.evidence.map(item => item.transcript), [{ sessionId, entryId: 'd1-e', fileOffset: null }]);
  const plain = requestDetail({ request: fixture.requests[0], sessions: fixture.sessions, now });
  assert.equal(plain.source, 'Reported by the source');
  assert.deepEqual(plain.evidence, []);
});

test('the state, origin and session filters cycle with the shared actions and wrap around', () => {
  const start = model().filter;
  assert.deepEqual(requestFilterAction('filter.next'), { axis: 'state', step: 1 });
  assert.deepEqual(requestFilterAction('filter.previous'), { axis: 'state', step: -1 });
  assert.equal(requestFilterAction('move.down'), null);
  assert.equal(cycleRequestFilter(start, 'state', [], 1).state, 'open');
  assert.equal(cycleRequestFilter(start, 'state', [], -1).state, 'possibly-unseen');
  assert.equal(cycleRequestFilter({ ...start, origin: 'unproven' }, 'origin', [], 1).origin, 'all');
  const ids = model().sessions.map(item => item.id);
  const first = cycleRequestFilter(start, 'session', ids, 1);
  assert.equal(first.sessionId, ids[0]);
  assert.equal(cycleRequestFilter({ ...first, sessionId: ids[ids.length - 1] }, 'session', ids, 1).sessionId, null);
});

test('the text filter matches shown text, session and origin, never withheld text', () => {
  assert.deepEqual(model({ query: 'ASK d2' }).rows.map(row => row.id), ['d2']);
  assert.deepEqual(model({ query: 'initial prompt' }).rows.map(row => row.id).includes('d1'), true);
  assert.deepEqual(model({ query: 'withheld' }).rows, []);
  assert.equal(model({ query: '   ' }).rows.length, requests.length);
});

test('unproven requests are listed with their label and the summary names every active filter', () => {
  assert.ok(model({ origin: 'unproven' }).rows.some(row => row.id === 'd2' && row.originLabel === 'Unproven origin'));
  assert.equal(describeRequestFilter(model({ state: 'open', origin: 'launch', sessionId, query: 'x' })), `state open · origin launch · session ${fixture.sessions[0].name} · ${fixture.sessions[0].laneId} · “x”`);
  assert.equal(describeRequestFilter(model()), 'state all · origin all · session all');
});

test('a withheld request and answer stay withheld in the detail and its evidence trail has the reset id', () => {
  const withheld = requestDetail({ request: derived[4], sessions: fixture.sessions, now });
  assert.deepEqual([withheld.textLines, withheld.withheld], [['[withheld]'], true]);
  const reset = requestDetail({ request: derived[2], sessions: fixture.sessions, now });
  assert.deepEqual(reset.evidence.map(item => [item.label, item.resetId]), [['Prompt', null], ['Reset while open', 'c1']]);
  assert.equal(reset.uncertain, uncertainLabels['reset-then-new-prompt']);
});
