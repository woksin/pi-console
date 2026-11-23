import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultDaemonPort = 4777;
export const defaultDataDir = (): string => join(homedir(), '.pi-console');

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Node-only file reading shared by the daemon and local clients; daemon field validation stays server-side. */
export function readDaemonConfigFile(dataDir: string): Record<string, unknown> {
  const path = join(dataDir, 'config.json');
  let parsed: unknown;
  try {
    parsed = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SyntaxError(`Invalid JSON in ${path}; fix the JSON syntax and restart the daemon.`, { cause: error });
  }
  if (!isObject(parsed)) throw new Error('config.json must be a JSON object');
  return parsed;
}

/** Clients need a fixed port; absent, unreadable, malformed or ephemeral-port configuration uses the default. */
export function readDaemonPort(dataDir: string): number {
  try {
    const { port } = readDaemonConfigFile(dataDir);
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535 ? port : defaultDaemonPort;
  } catch {
    return defaultDaemonPort;
  }
}
