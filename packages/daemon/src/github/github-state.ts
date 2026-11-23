import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { parseTargetKey } from '@pi-console/contract';

export const maxTargets = 500;
export const maxStateBytes = 1024 * 1024;
export const maxReservations = 500;

/** The latest outcome per target; `state: 'unknown'` is a failed refresh. Only normalized values, never source or CLI text. */
export interface TargetEntry {
  kind: 'issue' | 'pull-request' | null; state: 'open' | 'closed' | 'merged' | 'unknown'; closedAt: string | null;
  /** When this outcome was fetched (or failed); an observation keeps it however often it is re-published. */
  fetchedAt: string; failures: number; nextAt: number;
}
export interface GithubState {
  version: 1; initializedAt: number;
  /** Largest clock value ever seen: a clock that moves backwards never reopens a budget or renews evidence. */
  clockFloor: number;
  /** Start times of requests in the last hour, reserved before each spawn. */
  reservations: number[]; nextStartAt: number; pausedUntil: number;
  targets: Record<string, TargetEntry>;
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isoTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) && !Number.isNaN(Date.parse(value));
const kinds = new Set([null, 'issue', 'pull-request']);
const states = new Set(['open', 'closed', 'merged', 'unknown']);

function entryValid(value: unknown): value is TargetEntry {
  return isObject(value) && kinds.has(value.kind as string | null) && states.has(value.state as string) && isoTime(value.fetchedAt)
    && (value.closedAt === null || isoTime(value.closedAt)) && epoch(value.failures) && epoch(value.nextAt);
}

const clocks = ['initializedAt', 'clockFloor', 'nextStartAt', 'pausedUntil'];
const reservationsValid = (value: unknown): boolean => Array.isArray(value) && value.length <= maxReservations && value.every(epoch);
const targetsValid = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= maxTargets && entries.every(([key, entry]) => parseTargetKey(key)?.key === key && entryValid(entry));
};

export function stateValid(value: unknown): value is GithubState {
  return isObject(value) && value.version === 1 && clocks.every(name => epoch(value[name])) && reservationsValid(value.reservations) && targetsValid(value.targets);
}

export const freshState = (now: number, pausedUntil = 0): GithubState => ({
  version: 1, initializedAt: now, clockFloor: now, reservations: [], nextStartAt: 0, pausedUntil, targets: Object.create(null) as Record<string, TargetEntry>,
});

export interface StateStore { load(now: number): GithubState; save(state: GithubState): boolean }

/** A prior budget that cannot be recovered (state lost, corrupt, oversize or a link) means a one-hour cooldown instead of a renewed budget. */
export const lostBudgetCooldownMs = 3_600_000;

/**
 * The state file lives in the private data directory: a regular file only (a symlink or anything else is never read), at most
 * 1 MiB, strictly validated, written 0600 through a temporary file and an atomic rename. The `.init` marker distinguishes a first
 * start from a lost state.
 */
export class FileStateStore implements StateStore {
  readonly #path: string;
  readonly #marker: string;

  constructor(dataDir: string) {
    this.#path = join(dataDir, 'github-closures.json');
    this.#marker = join(dataDir, 'github-closures.init');
  }

  load(now: number): GithubState {
    const text = this.#read();
    if (text !== undefined) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (stateValid(parsed)) return { ...parsed, targets: Object.assign(Object.create(null) as Record<string, TargetEntry>, parsed.targets) };
      } catch { /* Corrupt: handled as a lost budget below. */ }
    }
    const initialised = this.#marked();
    if (!initialised) this.#mark(now);
    return freshState(now, initialised || text !== undefined ? now + lostBudgetCooldownMs : 0);
  }

  #read(): string | undefined {
    try {
      const info = lstatSync(this.#path);
      if (!info.isFile() || info.size > maxStateBytes) return '';
      return readFileSync(this.#path, 'utf8');
    } catch { return undefined; }
  }

  #marked(): boolean {
    try { lstatSync(this.#marker); return true; } catch { return false; }
  }

  #mark(now: number): void {
    try { const fd = openSync(this.#marker, 'wx', 0o600); writeSync(fd, String(now)); closeSync(fd); } catch { /* The state file itself also records initialisation. */ }
  }

  save(state: GithubState): boolean {
    const text = JSON.stringify(state);
    if (text.length > maxStateBytes) return false;
    const temporary = `${this.#path}.tmp`;
    try {
      try { unlinkSync(temporary); } catch { /* Nothing to replace. */ }
      const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.#path);
      return true;
    } catch { return false; }
  }
}
