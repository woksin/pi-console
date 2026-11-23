import { analyzeLinks, maxLinks, type EventLog, type LinkTarget, type NewEvent } from '@pi-console/contract';
import { observationEvent, type Lookup, type QueryTarget } from '@pi-console/adapters';
import type { SourceStatus } from '../ingestion/source-ingestion.ts';
import { maxTargets, type GithubState, type StateStore, type TargetEntry } from './github-state.ts';

export const githubSourceId = 'github-closures';

export interface Policy {
  /** Minimum time between two request starts. */ minGapMs: number;
  /** Requests per rolling hour. */ hourlyRequests: number;
  /** A successful observation is refreshed after this. */ ttlMs: number;
  /** Failure backoff: first and maximum. */ backoffMs: number; maxBackoffMs: number;
  /** Question associations handled per poll. */ associationsPerPoll: number;
  /** Events appended per transaction. */ batch: number;
}
export const defaultPolicy: Policy = {
  minGapMs: 10_000, hourlyRequests: 120, ttlMs: 900_000, backoffMs: 900_000, maxBackoffMs: 3_600_000, associationsPerPoll: 100, batch: 100,
};
const hourMs = 3_600_000;

/** The projected question metadata the worker reads; it never sees text, options or history. */
export interface QuestionMeta { id: string; revision: number; status: string; links: readonly string[] }
export interface GithubDeps {
  log: Pick<EventLog, 'append'>;
  questions: () => Iterable<QuestionMeta>;
  /** Exact canonical `owner/repo` names. */
  repositories: readonly string[];
  store: StateStore;
  lookup: (target: QueryTarget, signal: AbortSignal) => Promise<Lookup>;
  now?: () => number;
  policy?: Partial<Policy>;
}

interface Association { questionId: string; revision: number; target: LinkTarget }

const iso = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const entryOf = (state: GithubState, key: string): TargetEntry | undefined => state.targets[key];
/** When a lookup says requests must wait: a rate limit pauses at least an hour; any reported reset in the future is honoured. */
function pauseOf(result: Lookup, at: number): number {
  const reset = result.resumeAt === null ? 0 : timeOf(result.resumeAt);
  const limited = !result.ok && result.failure === 'rate-limited';
  return Math.max(limited ? at + hourMs : 0, reset > at ? reset : 0);
}
function candidate(question: QuestionMeta): boolean {
  if (question.status !== 'open') return false;
  return question.revision >= 1 && question.links.length <= maxLinks;
}
const first = <T>(items: readonly T[]): T | undefined => items[0];
const timeOf = (text: string): number => Date.parse(text);

/**
 * Optional, read-only source of observed GitHub state for the links of open questions. Only the exact allowlisted repositories
 * are ever queried, one `gh` child at a time, within a persisted request budget reserved before each spawn. Every outcome, including
 * a failure, is recorded as an observation fact; the projection decides what the latest fact means. Nothing is fetched on the first poll.
 */
export class GithubClosureWorker {
  readonly #deps: GithubDeps;
  readonly #policy: Policy;
  readonly #allowed: ReadonlySet<string>;
  readonly #published = new Set<string>();
  readonly #stop = new AbortController();
  #state: GithubState | undefined;
  #cursor = 0;
  #first = true;
  #halted = false;
  #lastPollAt: string | null = null;

  constructor(deps: GithubDeps) {
    this.#deps = deps;
    this.#policy = { ...defaultPolicy, ...deps.policy };
    this.#allowed = new Set(deps.repositories);
  }

  get status(): SourceStatus {
    return { source: githubSourceId, files: 0, lagBytes: 0, lastPollAt: this.#lastPollAt, errors: this.#halted ? 1 : 0 };
  }

  abort(): void { this.#stop.abort(); }
  close(): void { this.#stop.abort(); }

  async poll(): Promise<void> {
    if (this.#stop.signal.aborted || this.#halted) return;
    const state = this.#state ??= this.#deps.store.load(this.#clock());
    this.#clock(state);
    if (!this.#first) await this.#refreshOne(state);
    this.#first = false;
    await this.#publish(state);
    this.#cursor += this.#policy.associationsPerPoll;
    this.#lastPollAt = iso(this.#clock(state));
  }

  /** Monotone: a clock that moves backwards is held at the highest value seen. */
  #clock(state?: GithubState): number {
    const now = (this.#deps.now ?? Date.now)();
    if (!state) return now;
    state.clockFloor = Math.max(state.clockFloor, now);
    return state.clockFloor;
  }

  /** All links recognised and all in allowlisted repositories; otherwise null (never a subset). */
  #allowedTargets(links: readonly string[]): LinkTarget[] | null {
    const { coverage, targets } = analyzeLinks(links);
    return coverage === 'complete' && targets.every(target => this.#allowed.has(`${target.owner}/${target.repo}`)) ? targets : null;
  }

  *#eligible(): Generator<{ id: string; revision: number; targets: LinkTarget[] }> {
    for (const question of this.#deps.questions()) {
      if (!candidate(question)) continue;
      const targets = this.#allowedTargets(question.links);
      if (targets) yield { id: question.id, revision: question.revision, targets };
    }
  }

  /** A rotating window over the eligible questions, so a large queue is covered fairly across polls. */
  #window(): Association[] {
    const all = [...this.#eligible()];
    if (all.length === 0) return [];
    const start = this.#cursor % all.length;
    const chosen = [...all.slice(start), ...all.slice(0, start)].slice(0, this.#policy.associationsPerPoll);
    return chosen.flatMap(question => question.targets.map(target => ({ questionId: question.id, revision: question.revision, target })));
  }

  #due(entries: Association[], state: GithubState, at: number): LinkTarget[] {
    const byKey = new Map(entries.map(item => [item.target.key, item.target]));
    const fetched = (target: LinkTarget): number => { const entry = entryOf(state, target.key); return entry ? timeOf(entry.fetchedAt) : 0; };
    const admits = this.#evictable(state) !== null;
    const due = (target: LinkTarget): boolean => { const entry = entryOf(state, target.key); return entry ? entry.nextAt <= at : admits; };
    return [...byKey.values()].filter(due).sort((a, b) => fetched(a) - fetched(b));
  }

  #mayStart(state: GithubState, at: number): boolean {
    state.reservations = state.reservations.filter(start => start > at - hourMs && start <= at);
    return at >= state.pausedUntil && at >= state.nextStartAt && state.reservations.length < this.#policy.hourlyRequests;
  }

  async #refreshOne(state: GithubState): Promise<void> {
    const at = this.#clock(state);
    const target = first(this.#due(this.#window(), state, at));
    if (!target || !this.#mayStart(state, at)) return;
    state.reservations.push(at);
    state.nextStartAt = at + this.#policy.minGapMs;
    if (!this.#deps.store.save(state)) { this.#halted = true; return; }
    const result = await this.#look(target);
    if (this.#stop.signal.aborted) return;
    this.#record(state, target.key, result, this.#clock(state));
    if (!this.#deps.store.save(state)) this.#halted = true;
  }

  async #look(target: LinkTarget): Promise<Lookup> {
    try { return await this.#deps.lookup({ owner: target.owner, repo: target.repo, number: target.number }, this.#stop.signal); }
    catch { return { ok: false, failure: 'unavailable', resumeAt: null }; }
  }

  #record(state: GithubState, key: string, result: Lookup, at: number): void {
    state.pausedUntil = Math.max(state.pausedUntil, pauseOf(result, at));
    const known = state.targets[key] as TargetEntry | undefined;
    if (!known && !this.#room(state)) return;
    const failures = result.ok ? 0 : (known?.failures ?? 0) + 1;
    const nextAt = at + (result.ok ? this.#policy.ttlMs : this.#backoff(failures));
    const fetchedAt = iso(at);
    state.targets[key] = result.ok ? { kind: result.kind, state: result.state, closedAt: result.closedAt, fetchedAt, failures, nextAt } : { kind: null, state: 'unknown', closedAt: null, fetchedAt, failures, nextAt };
  }

  #backoff(failures: number): number { return Math.min(this.#policy.maxBackoffMs, this.#policy.backoffMs * 2 ** Math.min(failures - 1, 10)); }

  /** The key to drop to admit a new target: '' when there is room, null when the cache is full of still-linked targets (the new target is then not queried and stays unverified). */
  #evictable(state: GithubState): string | null {
    const keys = Object.keys(state.targets);
    if (keys.length < maxTargets) return '';
    const current = new Set([...this.#eligible()].flatMap(question => question.targets.map(target => target.key)));
    return first(keys.filter(key => !current.has(key)).sort((a, b) => timeOf(state.targets[a].fetchedAt) - timeOf(state.targets[b].fetchedAt))) ?? null;
  }

  #room(state: GithubState): boolean {
    const drop = this.#evictable(state);
    if (drop === null) return false;
    if (drop !== '') Reflect.deleteProperty(state.targets, drop);
    return true;
  }

  /** Publishes the cached latest outcome for every current association once; the log's idempotency absorbs a restart's repeats. */
  async #publish(state: GithubState): Promise<void> {
    const events: NewEvent[] = [];
    for (const { questionId, revision, target } of this.#window()) {
      const entry = state.targets[target.key] as TargetEntry | undefined;
      const marker = `${questionId}|${String(revision)}|${target.key}|${entry?.fetchedAt ?? ''}`;
      if (!entry || this.#published.has(marker)) continue;
      const event = observationEvent({ questionId, revision, target: target.key, kind: entry.kind, state: entry.state, closedAt: entry.closedAt, fetchedAt: entry.fetchedAt });
      if (event) { events.push(event); this.#published.add(marker); }
    }
    if (this.#published.size > 10_000) this.#published.clear();
    for (let index = 0; index < events.length; index += this.#policy.batch) await this.#deps.log.append(events.slice(index, index + this.#policy.batch));
  }
}
