import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterQuestionRows, questionsViewModel } from './questions.ts';
import { fixture, golden, now } from '../test-support.ts';

test('open blocking questions sort first and counts add up', () => {
  const model = questionsViewModel({ questions: fixture.questions, sessions: fixture.sessions, now });
  assert.equal(model.rows[0].blocking, true);
  assert.equal(model.rows[0].status.status, 'needs-you');
  assert.equal(model.open, fixture.questions.filter(q => q.status === 'open').length);
  golden('questions', model);
});

test('the filter matches question text and session name, ignoring case', () => {
  const { rows } = questionsViewModel({ questions: fixture.questions, sessions: fixture.sessions, now });
  assert.deepEqual(filterQuestionRows(rows, ''), rows);
  const text = rows[0].text.slice(1, 6).toUpperCase();
  assert.ok(filterQuestionRows(rows, text).includes(rows[0]));
  assert.ok(filterQuestionRows(rows, rows[0].session).includes(rows[0]));
  assert.deepEqual(filterQuestionRows(rows, 'no-such-question-zzz'), []);
});

const base = { sessionId: 's1', kind: 'question', text: 'Ask?', options: [], urgency: 'normal', blocking: false, status: 'open', createdAt: '2026-11-01T00:00:00.000Z' };
const ask = (id: string, extra: object = {}) => ({ ...base, id, ...extra }) as unknown as (typeof fixture.questions)[number];
const day = 86_400_000;
const rowsOf = (questions: (typeof fixture.questions), options: object = {}) => questionsViewModel({ questions, sessions: [], now, ...options }).rows;
const entry = (sequence: number, at: string, extra: object = {}) => ({ sequence, operation: 'comment', at, actor: 'L0', withheld: false, ...extra });

test('sorting by priority, updated and activity is deterministic with id ties', () => {
  const questions = [
    ask('b', { updatedAt: '2026-11-10T00:00:00Z', history: [entry(1, '2026-11-12T00:00:00Z')] }),
    ask('a', { updatedAt: '2026-11-10T00:00:00Z', history: [entry(1, '2026-11-12T00:00:00Z')] }),
    ask('c', { updatedAt: '2026-11-11T00:00:00Z', blocking: true, history: [entry(1, '2026-11-05T00:00:00Z')] }),
    ask('d', { status: 'closed', createdAt: '2026-11-15T00:00:00Z' }),
  ];
  const order = (sort: 'priority' | 'updated' | 'activity') => rowsOf(questions, { sort }).map(row => row.id);
  assert.deepEqual(order('priority'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(order('updated'), ['d', 'c', 'a', 'b']);
  assert.deepEqual(order('activity'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(rowsOf(questions).map(row => row.id), order('priority'));
});

test('history rows are newest first, sanitized and keep distinct actors and notes', () => {
  const [row] = rowsOf([ask('h', { history: [entry(2, '2026-11-02T00:00:00Z', { actor: 'user', excerpt: 'second \u001b[31mred\u001b[0m' }), entry(1, '2026-11-01T00:00:00Z', { operation: 'created', actor: null, withheld: true })] })]);
  assert.deepEqual(row.history?.map(item => [item.key, item.operation, item.actor, item.excerpt, item.withheld]), [['2', 'commented', 'user', 'second red', false], ['1', 'created', 'unknown', null, true]]);
});

test('a shortened history note says so in its text and flag; others are untouched', () => {
  const [row] = rowsOf([ask('t', { history: [entry(2, '2026-11-02T00:00:00Z', { excerpt: 'cut here', truncated: true }), entry(1, '2026-11-01T00:00:00Z', { excerpt: 'whole' })] })]);
  assert.deepEqual(row.history?.map(item => [item.excerpt, item.shortened]), [['cut here… (shortened)', true], ['whole', false]]);
});

test('old questions without the v1 fields stay usable with an explicit missing-history state', () => {
  const [row] = rowsOf([ask('old')]);
  assert.deepEqual([row.history, row.updated, row.updatedAt, row.lastActivityAt, row.links], [null, '–', null, base.createdAt, []]);
  assert.match(row.lastActivity, /ago$/);
});

test('last activity is the newest history entry, else the stored update, and can differ from updated', () => {
  const [withHistory] = rowsOf([ask('x', { updatedAt: '2026-11-19T00:00:00Z', history: [entry(1, '2026-11-18T00:00:00Z', { operation: 'comment', actor: 'L0' })] })]);
  assert.equal(withHistory.lastActivity, 'commented by L0, 2d ago');
  assert.equal(withHistory.lastActivityAt, '2026-11-18T00:00:00Z');
  assert.equal(rowsOf([ask('y', { updatedAt: '2026-11-19T09:25:00Z' })])[0].lastActivity, '1d ago');
});

test('open questions turn stale exactly at the threshold, and recorded activity clears the badge', () => {
  const at = (ms: number) => new Date(now - ms).toISOString();
  const stale = (createdAt: string, extra: object = {}, options: object = {}) => rowsOf([ask('s', { createdAt, ...extra })], options)[0].stale;
  assert.equal(stale(at(7 * day)), 'Stale · no activity for 7d');
  assert.equal(stale(at(7 * day - 1000)), null);
  assert.equal(stale(at(7 * day), { history: [entry(1, at(day))] }), null);
  assert.equal(stale(at(2 * day), {}, { staleDays: 1 }), 'Stale · no activity for 2d');
  assert.equal(stale(at(13 * day), {}, { staleDays: 14 }), null);
  assert.equal(stale(at(-5 * day)), null, 'future timestamps are clamped, never stale');
  for (const status of ['answered', 'deferred', 'closed']) assert.equal(stale(at(30 * day), { status }), null, status);
});

const seen = (target: string, extra: object = {}) => ({ target, kind: 'issue', state: 'closed', closedAt: '2026-11-19T00:00:00Z', fetchedAt: '2026-11-20T11:30:00Z', source: 'github-gh', ...extra });
const mootOf = (question: object, at = now) => questionsViewModel({ questions: [ask('m', question)], sessions: [], now: at }).rows[0];

test('possibly moot needs every link freshly observed closed or merged, and shows inspectable evidence', () => {
  const fresh = Date.parse('2026-11-20T12:00:00Z');
  const row = mootOf({ links: ['a/b#1', 'https://github.com/a/b/pull/2'], linkEvidence: [seen('a/b#1'), seen('a/b#2', { kind: 'pull-request', state: 'merged' })] }, fresh);
  assert.equal(row.moot?.label, 'Possibly moot');
  assert.deepEqual(row.moot?.evidence.map(item => [item.target, item.kind, item.state, item.closedAt, item.source, item.fetchedAt, item.current]), [
    ['a/b#1', 'issue', 'closed', '2026-11-19T00:00:00Z', 'github-gh', '2026-11-20T11:30:00Z', true],
    ['a/b#2', 'pull request', 'merged', '2026-11-19T00:00:00Z', 'github-gh', '2026-11-20T11:30:00Z', true],
  ]);
  assert.match(row.moot?.evidence[0].text ?? '', /a\/b#1 · issue closed · closed 2026-11-19T00:00:00Z · fetched 30m ago · github-gh/);
  assert.equal(row.status.status, 'open');
});

test('the advisory expires on the supplied clock, never on new data, and stale evidence is shown as stale history', () => {
  const links = ['a/b#1'], linkEvidence = [seen('a/b#1')];
  const later = Date.parse('2026-11-20T12:31:00Z');
  const row = mootOf({ links, linkEvidence }, later);
  assert.equal(row.moot?.label, null);
  assert.match(row.moot?.explanation ?? '', /more than an hour old/);
  assert.match(row.moot?.evidence[0].text ?? '', /stale · fetched/);
  assert.equal(row.moot?.evidence[0].current, false);
});

test('nothing is marked for open, unknown, unchecked, unsupported, non-open or evidence-free questions, and counts and order never change', () => {
  const at = Date.parse('2026-11-20T12:00:00Z');
  const cases: [object, RegExp][] = [
    [{ links: ['a/b#1'], linkEvidence: [seen('a/b#1', { state: 'open', closedAt: null })] }, /observed open/],
    [{ links: ['a/b#1'], linkEvidence: [seen('a/b#1', { state: 'unknown', kind: null, closedAt: null })] }, /could not be confirmed/],
    [{ links: ['a/b#1', 'a/b#2'], linkEvidence: [seen('a/b#1')] }, /not been checked/],
    [{ links: ['a/b#1', 'a prose link'], linkEvidence: [seen('a/b#1')] }, /not recognised/],
  ];
  for (const [question, text] of cases) {
    const row = mootOf(question, at);
    assert.equal(row.moot?.label, null);
    assert.match(row.moot?.explanation ?? '', text);
  }
  assert.equal(mootOf({ links: ['a/b#1'] }, at).moot, undefined);
  assert.equal(mootOf({ status: 'answered', links: ['a/b#1'], linkEvidence: [seen('a/b#1')] }, at).moot, undefined);
  const plain = ask('x', { links: ['a/b#1'], blocking: true });
  const marked = ask('x', { links: ['a/b#1'], blocking: true, linkEvidence: [seen('a/b#1')] });
  const model = (question: typeof plain) => questionsViewModel({ questions: [question], sessions: [], now: at });
  assert.deepEqual([model(marked).open, model(marked).blocking, model(marked).rows[0].status], [model(plain).open, model(plain).blocking, model(plain).rows[0].status]);
});

test('hostile link and evidence text is sanitized into inert text', () => {
  const evil = '\u001b]8;;http://evil\u0007a/b#1\u001b[31m';
  const row = mootOf({ links: [evil], linkEvidence: [seen('a/b#1')] });
  assert.ok(!JSON.stringify(row).includes('\u001b'));
  assert.equal(row.moot?.label, null);
});
