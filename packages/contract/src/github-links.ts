// Strict parsing of question links into GitHub issue/PR targets, and the pure "possibly moot" policy.
// Links are untrusted display text: only an entire, fully recognised reference becomes a target; nothing is ever repaired or extracted.

export const maxLinks = 100;
export const maxLinkLength = 512;
export const maxTargets = 50;
/** Closure evidence is advisory for one hour after it was fetched. */
export const evidenceMaxAgeMs = 3_600_000;
export const clockSkewMs = 300_000;
export const githubSource = 'github-gh';

const owner = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?';
const repo = '[A-Za-z0-9_][A-Za-z0-9._-]{0,99}';
const number = '[1-9][0-9]{0,9}';
const printable = /^[\x21-\x7e]+$/;
const repositoryPattern = new RegExp(`^(${owner})/(${repo})$`);
const shorthandPattern = new RegExp(`^(${owner})/(${repo})#(${number})$`);
const urlPattern = new RegExp(`^https://[Gg][Ii][Tt][Hh][Uu][Bb]\\.[Cc][Oo][Mm]/(${owner})/(${repo})/(issues|pull)/(${number})(?:[?#][^\\\\]*)?$`);
const maxNumber = 2_147_483_647;

export type LinkKind = 'issue' | 'pull-request';
export interface LinkTarget { key: string; owner: string; repo: string; number: number; expected: LinkKind | null }
export type LinkCoverage = 'complete' | 'empty' | 'too-many' | 'unsupported' | 'conflict';
export interface LinkAnalysis { coverage: LinkCoverage; targets: LinkTarget[] }

const boundedPrintable = (text: string, limit: number): boolean => text.length <= limit && printable.test(text);
const dotSegment = (name: string): boolean => name === '.' || name === '..';

/** `owner/repo` in canonical lower case, or null. Used for the allowlist, never for links. */
export function parseRepository(text: unknown): string | null {
  if (typeof text !== 'string' || !boundedPrintable(text, 140)) return null;
  const match = repositoryPattern.exec(text);
  return match && !dotSegment(match[2]) ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

const targetOf = (ownerName: string, repoName: string, digits: string, expected: LinkKind | null): LinkTarget | null => {
  const value = Number(digits);
  if (dotSegment(repoName) || value > maxNumber) return null;
  const name = ownerName.toLowerCase(), project = repoName.toLowerCase();
  return { key: `${name}/${project}#${String(value)}`, owner: name, repo: project, number: value, expected };
};

/** The whole trimmed text must be `owner/repo#N` or an `https://github.com/owner/repo/(issues|pull)/N` URL. */
export function parseLink(text: unknown): LinkTarget | null {
  if (typeof text !== 'string' || text.length > maxLinkLength) return null;
  const trimmed = text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  if (!printable.test(trimmed)) return null;
  const short = shorthandPattern.exec(trimmed);
  if (short) return targetOf(short[1], short[2], short[3], null);
  const url = urlPattern.exec(trimmed);
  return url ? targetOf(url[1], url[2], url[4], url[3] === 'pull' ? 'pull-request' : 'issue') : null;
}

/** Canonical target keys parse back to their parts; anything else is refused. */
export function parseTargetKey(key: unknown): LinkTarget | null {
  return typeof key === 'string' && key.length <= 160 ? parseLink(key) : null;
}

/** Bounded before parsing; any unsupported, oversized or conflicting link makes coverage incomplete, never a subset. */
export function analyzeLinks(links: unknown): LinkAnalysis {
  if (!Array.isArray(links) || links.length === 0) return incomplete('empty');
  if (links.length > maxLinks) return incomplete('too-many');
  const byKey = new Map<string, LinkTarget>();
  for (const link of links as unknown[]) {
    const problem = addTarget(byKey, parseLink(link));
    if (problem) return incomplete(problem);
  }
  return byKey.size > maxTargets ? incomplete('too-many') : { coverage: 'complete', targets: [...byKey.values()] };
}

/** Adds one parsed link, merging duplicates and preferring the one that names its kind; returns why coverage fails, if it does. */
function addTarget(byKey: Map<string, LinkTarget>, target: LinkTarget | null): LinkCoverage | null {
  if (!target) return 'unsupported';
  const known = byKey.get(target.key);
  if (conflicts(known, target)) return 'conflict';
  if (!known?.expected) byKey.set(target.key, target);
  return null;
}

const incomplete = (coverage: LinkCoverage): LinkAnalysis => ({ coverage, targets: [] });
const conflicts = (known: LinkTarget | undefined, target: LinkTarget): boolean =>
  Boolean(known?.expected && target.expected && known.expected !== target.expected);

export type LinkState = 'open' | 'closed' | 'merged' | 'unknown';
export interface LinkObservation {
  target: string; kind: LinkKind | null; state: LinkState; closedAt: string | null; fetchedAt: string; source: typeof githubSource;
}

export const targetUrl = (target: LinkTarget, kind: LinkKind): string =>
  `https://github.com/${target.owner}/${target.repo}/${kind === 'pull-request' ? 'pull' : 'issues'}/${String(target.number)}`;

export type MootReason = 'moot' | 'no-links' | 'unsupported-links' | 'open' | 'unknown' | 'unverified' | 'stale';
export interface MootTarget {
  target: string; kind: LinkKind | null; state: LinkState | 'unverified'; closedAt: string | null; fetchedAt: string | null; source: string | null;
  url: string | null; fresh: boolean;
}
export interface MootAssessment { moot: boolean; reason: MootReason; coverage: LinkCoverage; targets: MootTarget[] }

const valid = (iso: unknown): number => (typeof iso === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(iso) ? Date.parse(iso) : Number.NaN);

function assess(target: LinkTarget, found: LinkObservation | undefined, now: number): { row: MootTarget; reason: MootReason | null } {
  if (!found) return { row: { target: target.key, kind: null, state: 'unverified', closedAt: null, fetchedAt: null, source: null, url: null, fresh: false }, reason: 'unverified' };
  const row = rowOf(target, found);
  if (row.state === 'unknown' || row.state === 'open') return { row, reason: row.state };
  if (!closureConsistent(found)) return { row: { ...row, state: 'unknown' }, reason: 'unknown' };
  const fresh = isFresh(valid(found.fetchedAt), now);
  return { row: { ...row, fresh }, reason: fresh ? null : 'stale' };
}

function rowOf(target: LinkTarget, found: LinkObservation): MootTarget {
  const kindOk = found.kind === null || target.expected === null || found.kind === target.expected;
  return {
    target: target.key, kind: found.kind, state: kindOk ? found.state : 'unknown', closedAt: found.closedAt, fetchedAt: found.fetchedAt, source: found.source,
    url: found.kind ? targetUrl(target, found.kind) : null, fresh: false,
  };
}

/** A closure needs a known kind and parseable times, with the close not after the fetch (beyond skew). */
function closureConsistent(found: LinkObservation): boolean {
  const fetched = valid(found.fetchedAt), closed = valid(found.closedAt);
  return found.kind !== null && !Number.isNaN(fetched) && !Number.isNaN(closed) && closed <= fetched + clockSkewMs;
}

const isFresh = (fetched: number, now: number): boolean => fetched <= now + clockSkewMs && now - fetched <= evidenceMaxAgeMs;

const severity: MootReason[] = ['open', 'unknown', 'unverified', 'stale'];

/**
 * An advisory only: every current link must be a recognised target whose latest observation is a fresh closed or merged
 * state. Anything else (unsupported, missing, unknown, open, stale, future-dated) withholds it. Local status never counts.
 */
export function assessMoot(links: readonly string[] | undefined, evidence: readonly LinkObservation[] | undefined, now: number): MootAssessment {
  const { coverage, targets } = analyzeLinks(links ?? []);
  if (coverage !== 'complete') return { moot: false, reason: coverage === 'empty' ? 'no-links' : 'unsupported-links', coverage, targets: [] };
  const latest = new Map((evidence ?? []).map(item => [item.target, item]));
  const results = targets.map(target => assess(target, latest.get(target.key), now));
  const reasons = results.flatMap(result => (result.reason ? [result.reason] : []));
  const reason = severity.find(candidate => reasons.includes(candidate)) ?? 'moot';
  return { moot: reason === 'moot', reason, coverage, targets: results.map(result => result.row) };
}
