import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLinks, assessMoot, evidenceMaxAgeMs, maxLinkLength, maxLinks, parseLink, parseRepository, type LinkObservation } from './github-links.ts';

const now = Date.parse('2026-01-02T12:00:00Z');
const fetchedAt = '2026-01-02T11:30:00Z';
const closed = (target: string, extra: Partial<LinkObservation> = {}): LinkObservation =>
  ({ target, kind: 'issue', state: 'closed', closedAt: '2026-01-01T00:00:00Z', fetchedAt, source: 'github-gh', ...extra });

test('shorthand and github.com URLs become canonical lower-case targets; query and fragment are discarded', () => {
  assert.equal(parseLink(' Owner/Repo#12 ')?.key, 'owner/repo#12');
  const url = parseLink('https://GitHub.com/Owner/Repo/pull/7?token=ghp_abcdefghijkl#frag');
  assert.deepEqual([url?.key, url?.expected], ['owner/repo#7', 'pull-request']);
  assert.equal(parseLink('https://github.com/o/r/issues/3')?.expected, 'issue');
});

test('hostile and unsupported link text is never a target', () => {
  const hostile = [
    '$(rm -rf /)#1', 'a/b#1; id', 'a/b#1\nc/d#2', 'a/b#1\0', '--repo/x#1', '--repo=x/y#1', 'a/--repo#1', '`id`/x#1', '\u001b[31ma/b#1', '\u001b]8;;http://x\u0007a/b#1',
    '[a/b#1](http://evil)', '<a/b#1>', 'а/b#1', 'ａ/b#1', 'a/b #1', '#12', 'a/b#0', 'a/b#-1', 'a/b#01', 'a/b#99999999999', 'a/b#2147483648', 'a/./..#1', 'a/../b#1',
    'https://github.com.evil.com/a/b/issues/1', 'https://evil.com/github.com/a/b/issues/1', 'https://user@github.com/a/b/issues/1', 'https://github.com@evil.com/a/b/issues/1',
    'https://github.com:443/a/b/issues/1', 'http://github.com/a/b/issues/1', 'git@github.com:a/b.git', 'file:///a/b/issues/1', 'https://github.com/a%2Fb/c/issues/1',
    'https://github.com/a/b/issues/%31', 'https://github.com/a/b/../c/issues/1', 'https://github.com/a/b/issues/1/', 'https://github.com/a/b/issues/1/files',
    'https://github.com/a/b/issues/1 trailing', 'https://github.com\\a/b/issues/1', 'https://github.com/a/b/issues/1?x=\\y', 'https://github.com/a/b/commit/1', 'https://ghe.example.com/a/b/issues/1',
    'see a/b#1', 'a/b#1 and c/d#2', '', ' ', 'x'.repeat(maxLinkLength + 1), 42, null, { toString: () => 'a/b#1' },
  ];
  for (const link of hostile) assert.equal(parseLink(link), null, JSON.stringify(link));
});

test('repository allowlist entries need a strict owner/repo shape', () => {
  assert.equal(parseRepository('Owner/Repo'), 'owner/repo');
  for (const bad of ['owner', 'a/b/c', '*/b', 'a/*', '-a/b', 'a-/b', 'a/..', 'a/b#1', ' a/b', '--repo/x', 3, null]) assert.equal(parseRepository(bad), null, String(bad));
});

test('coverage is incomplete, never a subset, when anything is unsupported, oversized, conflicting or empty', () => {
  assert.equal(analyzeLinks([]).coverage, 'empty');
  assert.equal(analyzeLinks(undefined).coverage, 'empty');
  assert.equal(analyzeLinks(['a/b#1', 'just text']).coverage, 'unsupported');
  assert.equal(analyzeLinks(['a/b#1', 'x'.repeat(maxLinkLength + 1)]).coverage, 'unsupported');
  assert.equal(analyzeLinks(Array.from({ length: maxLinks + 1 }, (_, index) => `a/b#${String(index + 1)}`)).coverage, 'too-many');
  assert.equal(analyzeLinks(Array.from({ length: 51 }, (_, index) => `a/b#${String(index + 1)}`)).coverage, 'too-many');
  assert.equal(analyzeLinks(['https://github.com/a/b/issues/1', 'https://github.com/a/b/pull/1']).coverage, 'conflict');
  const merged = analyzeLinks(['A/B#1', 'https://github.com/a/b/issues/1', 'a/b#1']);
  assert.deepEqual([merged.coverage, merged.targets.length, merged.targets[0].expected], ['complete', 1, 'issue']);
  assert.equal(analyzeLinks(Array.from({ length: 50 }, (_, index) => `a/b#${String(index + 1)}`)).targets.length, 50);
});

test('prototype-like owners and repositories stay ordinary strings', () => {
  const target = parseLink('constructor/__proto__#1');
  assert.equal(target?.key, 'constructor/__proto__#1');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('moot requires every link freshly observed closed or merged', () => {
  const links = ['a/b#1', 'a/b#2'];
  assert.equal(assessMoot(links, [closed('a/b#1'), closed('a/b#2', { kind: 'pull-request', state: 'merged' })], now).moot, true);
  const reasons = (evidence: LinkObservation[], list = links) => assessMoot(list, evidence, now).reason;
  assert.equal(reasons([closed('a/b#1')]), 'unverified');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { state: 'open', closedAt: null })]), 'open');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { state: 'unknown', kind: null, closedAt: null })]), 'unknown');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { fetchedAt: new Date(now - evidenceMaxAgeMs - 1000).toISOString() })]), 'stale');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { fetchedAt: '2026-01-03T00:00:00Z' })]), 'stale');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { closedAt: null })]), 'unknown');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { closedAt: '2026-01-02T11:59:00Z' })]), 'unknown');
  assert.equal(reasons([closed('a/b#1'), closed('a/b#2', { closedAt: 'garbage' })]), 'unknown');
  assert.equal(reasons([], []), 'no-links');
  assert.equal(reasons([closed('a/b#1')], ['a/b#1', 'prose']), 'unsupported-links');
  assert.equal(reasons([closed('a/b#1', { kind: 'pull-request' })], ['https://github.com/a/b/issues/1']), 'unknown');
  assert.equal(assessMoot(links, undefined, now).moot, false);
});

test('the clock moving backwards withholds rather than extends the advisory', () => {
  assert.equal(assessMoot(['a/b#1'], [closed('a/b#1')], now - 2 * evidenceMaxAgeMs).moot, false);
  assert.equal(assessMoot(['a/b#1'], [closed('a/b#1')], now + evidenceMaxAgeMs).moot, false);
});
