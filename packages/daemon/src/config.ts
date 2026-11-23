import { defaultDaemonPort, defaultDataDir, readDaemonConfigFile } from '@pi-console/contract/daemon-config';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { sourceIds, type SourceId } from './ingestion/source-ids.ts';

/** Daemon configuration. The bind address is not configurable: the daemon listens on 127.0.0.1 only. */
export interface DaemonConfig {
  /** Owner-only directory with the token file, `console.db` and `config.json`. */
  dataDir: string;
  /** TCP port; 0 picks a free one. */
  port: number;
  /** Built web bundle served at `/`; absent or missing means API only. */
  webDist: string | undefined;
  /** The pi agent directory (`~/.pi/agent`) every agent-side source directory derives from. Read-only. */
  agentRoot: string;
  /** The orch directory (`~/.pi/orch`, a sibling of the agent directory) with heartbeats and the message inbox. */
  orchRoot: string;
  /** The lanes root with `lanes.json` and `.state/roster` (where `LANES_DIR` points). No default exists: absent means no registry feed. */
  lanesRoot: string | undefined;
  /** Directory with the `<LANE>.status` files (`<agentRoot>/lane-status` unless set). Read-only. */
  laneStatusDir: string;
  /** Directories with pi session JSONL files. Derived from `agentRoot` unless set explicitly. */
  sessionRoots: string[];
  /** Per-source switches for the non-session sources. Session ingestion is on whenever there are session roots. */
  sources: Record<SourceId, boolean>;
  /** Poll interval for the snapshot-style and low-rate sources (event-model 2.1: 2-5 s). */
  sourcePollMs: number;
  backfillWindowDays: number;
  /** SSE deltas retained for `Last-Event-ID` resume. */
  replayWindow: number;
  heartbeatMs: number;
  pollMs: number;
  /** Opt-in native memory review requests; never human authority. */
  memoryActions: boolean;
}

export { defaultDataDir };

export function defaultConfig(dataDir = defaultDataDir()): DaemonConfig {
  const agentRoot = join(homedir(), '.pi', 'agent');
  return {
    dataDir, memoryActions: false, port: defaultDaemonPort, webDist: undefined, agentRoot, orchRoot: join(homedir(), '.pi', 'orch'),
    lanesRoot: undefined, laneStatusDir: join(agentRoot, 'lane-status'),
    sessionRoots: [join(agentRoot, 'sessions')], sources: Object.fromEntries(sourceIds.map(id => [id, true])) as Record<SourceId, boolean>,
    backfillWindowDays: 14, replayWindow: 10_000, heartbeatMs: 15_000, pollMs: 1_000, sourcePollMs: 2_000,
  };
}

type FileConfig = Partial<Pick<DaemonConfig, 'memoryActions' | 'port' | 'webDist' | 'agentRoot' | 'orchRoot' | 'lanesRoot' | 'laneStatusDir' | 'sessionRoots' | 'sources' | 'backfillWindowDays' | 'sourcePollMs'>>;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Command-line overrides; `sources` may name just the sources to change. */
export type ConfigOverrides = Partial<Omit<DaemonConfig, 'sources'>> & { sources?: Partial<Record<SourceId, boolean>> };

const sourceSwitches = (value: unknown): boolean =>
  isObject(value) && Object.entries(value).every(([id, on]) => (sourceIds as readonly string[]).includes(id) && typeof on === 'boolean');

const boundedInteger = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;

const pathIn = (directory: string, path: string): string => (isAbsolute(path) ? path : resolve(directory, path));

const pathList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

interface Field { valid: (value: unknown) => boolean; expected: string; read: (value: never, dataDir: string) => unknown }

const fields: Record<keyof FileConfig, Field> = {
  memoryActions: { valid: value => typeof value === 'boolean', expected: 'a boolean', read: (value: boolean) => value },
  port: { valid: value => boundedInteger(value, 65_535), expected: 'an integer 0-65535', read: (value: number) => value },
  backfillWindowDays: { valid: value => boundedInteger(value, 365), expected: 'an integer 0-365', read: (value: number) => value },
  webDist: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
  agentRoot: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
  orchRoot: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
  lanesRoot: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
  laneStatusDir: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
  sources: { valid: sourceSwitches, expected: `an object of booleans keyed by ${sourceIds.join(', ')}`, read: (value: Partial<Record<SourceId, boolean>>) => value },
  sourcePollMs: { valid: value => boundedInteger(value, 60_000) && value >= 250, expected: 'an integer 250-60000', read: (value: number) => value },
  sessionRoots: { valid: pathList, expected: 'a list of paths', read: (value: string[], dataDir) => value.map(root => pathIn(dataDir, root)) },
};

function checked(file: Record<string, unknown>, dataDir: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (!(name in file)) continue;
    if (!field.valid(file[name])) throw new Error(`config.json: ${name} must be ${field.expected}`);
    config[name] = field.read(file[name] as never, dataDir);
  }
  return config;
}

/** Flags go through the same validators as the file, so a flag cannot set a value the file would refuse. */
function checkedOverrides(overrides: ConfigOverrides): void {
  for (const [name, field] of Object.entries(fields)) {
    const value = (overrides as Record<string, unknown>)[name];
    if (value !== undefined && !field.valid(value)) {
      const flag = name === 'backfillWindowDays' ? 'backfill-days' : name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      throw Object.assign(new Error(`--${flag} must be ${field.expected}`), { code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' });
    }
  }
}

/** Defaults, then `<dataDir>/config.json` when present, then explicit overrides (command-line flags). */
export function loadConfig(dataDir: string, overrides: ConfigOverrides = {}): DaemonConfig {
  const parsed = readDaemonConfigFile(dataDir);
  checkedOverrides(overrides);
  const defaults = defaultConfig(dataDir);
  const file = checked(parsed, dataDir) as FileConfig;
  const merged = { ...defaults, ...file, ...overrides, sources: { ...defaults.sources, ...file.sources, ...overrides.sources } };
  const explicit = (name: keyof FileConfig) => file[name] !== undefined || overrides[name] !== undefined;
  const derived = {
    ...(explicit('sessionRoots') ? {} : { sessionRoots: [join(merged.agentRoot, 'sessions')] }),
    ...(explicit('laneStatusDir') ? {} : { laneStatusDir: join(merged.agentRoot, 'lane-status') }),
  };
  return { ...merged, ...derived };
}
