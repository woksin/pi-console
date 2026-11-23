import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Health, Settings } from '@pi-console/contract';
import type { Projector, SqliteEventLog } from '@pi-console/core';
import type { StreamHub } from '../stream/stream-hub.ts';
import type { DeltaBatcher } from '../stream/delta-batcher.ts';
import type { SessionIngestion } from '../ingestion/session-ingestion.ts';
import type { SourceSet } from '../ingestion/sources.ts';
import { sourceIds } from '../ingestion/source-ids.ts';
import { githubActive } from '../github/github-source.ts';
import { directoryDiagnostics, isProblem, summarizeAvailability, type Availability, type AvailabilityConfig } from '../ingestion/source-availability.ts';

export interface HealthParts {
  startedAt: string;
  dataDir: string;
  log: SqliteEventLog;
  projector: Projector;
  stream: StreamHub;
  ingestion: SessionIngestion;
  sources: SourceSet;
  batcher: DeltaBatcher;
  backfillWindowDays: number;
  eventLoop: Health['eventLoop'];
  /** Resolved configuration; the directories are probed afresh on every read. */
  config: AvailabilityConfig;
}

/** Database bytes including the WAL and shared-memory files that belong to it. */
function databaseBytes(dataDir: string): number {
  return ['console.db', 'console.db-wal', 'console.db-shm'].reduce((total, name) => {
    try {
      return total + statSync(join(dataDir, name)).size;
    } catch {
      return total;
    }
  }, 0);
}

/** The GitHub source has no directory to probe: it is `available` exactly when it can run (switched on and allowlisted). Never touches the network. */
const githubReported = (config: AvailabilityConfig): Availability => (config.ingest !== false && githubActive(config) ? 'available' : 'disabled');

export function healthOf(parts: HealthParts): Health {
  const { log, projector, stream, ingestion, sources } = parts;
  const backfillComplete = ingestion.backfillComplete && sources.backfillComplete;
  const lastSeq = log.lastSeq();
  const queueDepth = Math.max(0, lastSeq - projector.position) + parts.batcher.pending;
  const skipped = Object.values(projector.skipped.counts).reduce((total, count) => total + count, 0);
  const memory = process.memoryUsage();
  const availability = summarizeAvailability(directoryDiagnostics(parts.config));
  const statuses = [ingestion.status, ...sources.statuses()].map(source => ({ ...source, availability: source.source === 'github-closures' ? githubReported(parts.config) : availability.get(source.source as never) ?? 'disabled' as const }));
  const missingDirectory = [...availability.values()].some(isProblem);
  return {
    status: missingDirectory || statuses.some(source => source.errors > 0) ? 'degraded' : backfillComplete ? 'ok' : 'starting', startedAt: parts.startedAt,
    eventLog: { lastSeq, dbBytes: databaseBytes(parts.dataDir) },
    projection: { position: projector.position, queueDepth, skipped },
    eventLoop: parts.eventLoop,
    stream: { seq: stream.seq, clients: stream.clients, retained: stream.retained },
    agentRootAvailability: availability.get('agent-root'), sources: statuses,
    backfill: { complete: backfillComplete, windowDays: parts.backfillWindowDays },
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
  };
}

/** What `/settings` may reveal: no paths, no credentials. */
export function settingsOf(config: AvailabilityConfig, port: number): Settings {
  const availability = summarizeAvailability(directoryDiagnostics(config));
  const reported = (source: string) => (source === 'github-closures' ? githubReported(config) : availability.get(source as never) ?? 'disabled' as const);
  return {
    agentRootAvailability: availability.get('agent-root'),
    version: 1, bind: '127.0.0.1', port, backfillWindowDays: config.backfillWindowDays, replayWindow: config.replayWindow,
    webBundle: config.webDist !== undefined, sources: [
      { source: 'session-jsonl', enabled: config.ingest !== false && config.sessionRoots.length > 0, availability: reported('session-jsonl') },
      ...sourceIds.map(source => ({ source, enabled: config.ingest !== false && (source === 'github-closures' ? githubActive(config) : config.sources[source]), availability: reported(source) })),
    ],
  };
}
