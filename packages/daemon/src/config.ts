import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** Daemon configuration. The bind address is not configurable: the daemon listens on 127.0.0.1 only. */
export interface DaemonConfig {
  /** Owner-only directory with the token file, `console.db` and `config.json`. */
  dataDir: string;
  /** TCP port; 0 picks a free one. */
  port: number;
  /** Built web bundle served at `/`; absent or missing means API only. */
  webDist: string | undefined;
  /** Directories with pi session JSONL files. */
  sessionRoots: string[];
  backfillWindowDays: number;
  /** SSE deltas retained for `Last-Event-ID` resume. */
  replayWindow: number;
  heartbeatMs: number;
  pollMs: number;
}

export const defaultDataDir = (): string => join(homedir(), '.pi-console');

export function defaultConfig(dataDir = defaultDataDir()): DaemonConfig {
  return {
    dataDir, port: 4777, webDist: undefined, sessionRoots: [join(homedir(), '.pi', 'agent', 'sessions')],
    backfillWindowDays: 14, replayWindow: 10_000, heartbeatMs: 15_000, pollMs: 1_000,
  };
}

type FileConfig = Partial<Pick<DaemonConfig, 'port' | 'webDist' | 'sessionRoots' | 'backfillWindowDays'>>;

const boundedInteger = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;

const pathIn = (directory: string, path: string): string => (isAbsolute(path) ? path : resolve(directory, path));

function checked(file: Record<string, unknown>, dataDir: string): FileConfig {
  const config: FileConfig = {};
  if ('port' in file) {
    if (!boundedInteger(file.port, 65_535)) throw new Error('config.json: port must be an integer 0-65535');
    config.port = file.port;
  }
  if ('backfillWindowDays' in file) {
    if (!boundedInteger(file.backfillWindowDays, 365)) throw new Error('config.json: backfillWindowDays must be an integer 0-365');
    config.backfillWindowDays = file.backfillWindowDays;
  }
  if ('webDist' in file) {
    if (typeof file.webDist !== 'string') throw new Error('config.json: webDist must be a path');
    config.webDist = pathIn(dataDir, file.webDist);
  }
  if ('sessionRoots' in file) {
    const roots = file.sessionRoots;
    if (!Array.isArray(roots) || !roots.every(root => typeof root === 'string')) throw new Error('config.json: sessionRoots must be a list of paths');
    config.sessionRoots = roots.map(root => pathIn(dataDir, root));
  }
  return config;
}

/** Defaults, then `<dataDir>/config.json` when present, then explicit overrides (command-line flags). */
export function loadConfig(dataDir: string, overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const path = join(dataDir, 'config.json');
  const parsed: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('config.json must be a JSON object');
  return { ...defaultConfig(dataDir), ...checked(parsed as Record<string, unknown>, dataDir), ...overrides };
}
