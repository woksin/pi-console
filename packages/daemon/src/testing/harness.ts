import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '@pi-console/core';
import { scenario, testEvent } from '@pi-console/core/testing';
import { defaultConfig } from '../config.ts';
import { startDaemon, type DaemonOptions, type RunningDaemon } from '../daemon.ts';
import { loadToken } from '../security/token.ts';

export interface SpecDaemon { daemon: RunningDaemon; directory: string; token: string; close(): Promise<void> }

export const sessionStarted = (n: number, sessionId: string, cwd = '/synthetic/repo'): NewEvent =>
  testEvent(n, 'SessionStarted', { sessionId, cwd, model: null, role: 'main', parentSessionId: null });

/** Seed events: one known session plus the core mixed scenario. */
export const seedEvents = (): NewEvent[] => [sessionStarted(1_000_000, 's1'), ...scenario({ count: 300 })];

/** A daemon on a free port in a fresh data directory, with `seed` appended before start. Ingestion is off. */
export async function specDaemon(seed: readonly NewEvent[] = seedEvents(), options: Partial<DaemonOptions> = {}): Promise<SpecDaemon> {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-daemon-'));
  const log = new SqliteEventLog(join(directory, 'console.db'));
  await log.append(seed);
  log.close();
  const daemon = await startDaemon({ ...defaultConfig(directory), port: 0, sessionRoots: [], ingest: false, ...options });
  return {
    daemon, directory, token: loadToken(directory),
    async close() {
      await daemon.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Resolves once the stream id has moved past `seq`. */
export async function publishedAfter(daemon: RunningDaemon, seq: number): Promise<void> {
  for (let i = 0; i < 500 && daemon.stream.seq <= seq; i++) await new Promise(resolve => setTimeout(resolve, 2));
  if (daemon.stream.seq <= seq) throw new Error('No delta published');
}
