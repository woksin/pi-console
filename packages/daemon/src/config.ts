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

const pathList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

interface Field { valid: (value: unknown) => boolean; expected: string; read: (value: never, dataDir: string) => unknown }

const fields: Record<keyof FileConfig, Field> = {
  port: { valid: value => boundedInteger(value, 65_535), expected: 'an integer 0-65535', read: (value: number) => value },
  backfillWindowDays: { valid: value => boundedInteger(value, 365), expected: 'an integer 0-365', read: (value: number) => value },
  webDist: { valid: value => typeof value === 'string', expected: 'a path', read: (value: string, dataDir) => pathIn(dataDir, value) },
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

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Defaults, then `<dataDir>/config.json` when present, then explicit overrides (command-line flags). */
export function loadConfig(dataDir: string, overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const path = join(dataDir, 'config.json');
  const parsed: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!isObject(parsed)) throw new Error('config.json must be a JSON object');
  return { ...defaultConfig(dataDir), ...checked(parsed, dataDir), ...overrides };
}
