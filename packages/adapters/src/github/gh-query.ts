import { runGh, type ProcessLimits, type ProcessResult, type Spawn } from './gh-process.ts';

export interface QueryTarget { owner: string; repo: string; number: number }
export type Failure = 'unavailable' | 'rate-limited' | 'invalid';
export type ObservedState = 'open' | 'closed' | 'merged';
export type TargetKind = 'issue' | 'pull-request';
export type Lookup =
  | { ok: true; kind: TargetKind; state: ObservedState; closedAt: string | null; resumeAt: string | null }
  | { ok: false; failure: Failure; resumeAt: string | null };

/** Constant, read-only GraphQL document: no bodies, titles, comments or caller-selected fields. Aliases keep the two state enums apart. */
export const query = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issueOrPullRequest(number:$number){__typename ... on Issue{number closedAt issueState:state} ... on PullRequest{number closedAt mergedAt prState:state}}} rateLimit{remaining resetAt}}';

/** Fixed argv; owner, name and number are separate variables (`-f` is never file- or type-interpreted). The number is digits generated here. */
export function ghArguments(target: QueryTarget): string[] {
  return ['api', '--hostname', 'github.com', 'graphql', '-f', `query=${query}`, '-f', `owner=${target.owner}`, '-f', `name=${target.repo}`, '-F', `number=${String(target.number)}`];
}

const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTime = (value: unknown): value is string => typeof value === 'string' && timestamp.test(value) && !Number.isNaN(Date.parse(value));
const fail = (failure: Failure, resumeAt: string | null = null): Lookup => ({ ok: false, failure, resumeAt });

/** Rate and abuse limits are recognised from the shape of the failure only; nothing from it is kept. */
const limited = (text: string): boolean => /rate limit|RATE_LIMITED|abuse|secondary rate/i.test(text);

function parse(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch { return null; }
}

function resetOf(data: unknown): string | null {
  const limit = isObject(data) && isObject(data.rateLimit) ? data.rateLimit : null;
  return limit?.remaining === 0 && validTime(limit.resetAt) ? limit.resetAt : null;
}

const child = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

function itemOf(data: unknown, target: QueryTarget): Item | null {
  const item = child(child(data, 'repository'), 'issueOrPullRequest');
  return isObject(item) && item.number === target.number ? item : null;
}

type Item = Record<string, unknown>;
const closedAt = (item: Item): string | null | undefined => (item.closedAt === null ? null : validTime(item.closedAt) ? item.closedAt : undefined);
const found = (kind: TargetKind, state: ObservedState, at: string | null, resumeAt: string | null): Lookup => ({ ok: true, kind, state, closedAt: at, resumeAt });

function issueLookup(item: Item, resumeAt: string | null): Lookup {
  const closed = closedAt(item);
  if (item.issueState === 'OPEN' && closed === null) return found('issue', 'open', null, resumeAt);
  return item.issueState === 'CLOSED' && typeof closed === 'string' ? found('issue', 'closed', closed, resumeAt) : fail('invalid');
}

const openPull = (item: Item, closed: string | null | undefined): ObservedState | null => (closed === null && item.mergedAt === null ? 'open' : null);
const closedPull = (item: Item): ObservedState | null => (item.mergedAt === null ? 'closed' : null);
const mergedPull = (item: Item): ObservedState | null => (validTime(item.mergedAt) ? 'merged' : null);

function pullState(item: Item, closed: string | null | undefined): ObservedState | null {
  if (item.prState === 'OPEN') return openPull(item, closed);
  if (typeof closed !== 'string') return null;
  if (item.prState === 'CLOSED') return closedPull(item);
  return item.prState === 'MERGED' ? mergedPull(item) : null;
}

function pullLookup(item: Item, resumeAt: string | null): Lookup {
  const closed = closedAt(item);
  const state = pullState(item, closed);
  return state ? found('pull-request', state, closed ?? null, resumeAt) : fail('invalid');
}

const itemLookup = (item: Item, resumeAt: string | null): Lookup =>
  item.__typename === 'Issue' ? issueLookup(item, resumeAt) : item.__typename === 'PullRequest' ? pullLookup(item, resumeAt) : fail('invalid', resumeAt);

/** The process itself failed or was cut off: nothing to parse. */
function processFailure(result: ProcessResult): Lookup | null {
  if (result.end === 'overflow') return fail('invalid');
  return result.end === 'exit' ? null : fail('unavailable');
}

/** Whole-response validation: anything partial, mismatched or inconsistent is `invalid`, never a closure. */
export function lookupOf(result: ProcessResult, target: QueryTarget): Lookup {
  const early = processFailure(result);
  if (early) return early;
  const body = parse(result.stdout);
  if ([result.stderr, result.stdout].some(limited)) return fail('rate-limited', body ? resetOf(body.data) : null);
  return result.code === 0 ? bodyLookup(body, target) : fail('unavailable');
}

function bodyLookup(body: Record<string, unknown> | null, target: QueryTarget): Lookup {
  const data = cleanData(body);
  if (!data) return fail('invalid');
  const resumeAt = resetOf(data);
  const item = itemOf(data, target);
  return item ? itemLookup(item, resumeAt) : fail('invalid', resumeAt);
}

/** The `data` object of a response that carries no GraphQL errors, otherwise null. */
function cleanData(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (body?.errors !== undefined) return null;
  return isObject(body?.data) ? body.data : null;
}

export interface QueryOptions { spawn?: Spawn; limits?: Partial<ProcessLimits>; signal?: AbortSignal; env?: NodeJS.ProcessEnv }

/** One read-only lookup through the user's own `gh`. Never throws; every failure is a category with no text. */
export async function lookupTarget(target: QueryTarget, options: QueryOptions = {}): Promise<Lookup> {
  return lookupOf(await runGh(ghArguments(target), options), target);
}
