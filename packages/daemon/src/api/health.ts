import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Health, Settings } from '@pi-console/contract';
import type { Projector, SqliteEventLog } from '@pi-console/core';
import type { DaemonConfig } from '../config.ts';
import type { StreamHub } from '../stream/stream-hub.ts';
import type { DeltaBatcher } from '../stream/delta-batcher.ts';
import type { SessionIngestion } from '../ingestion/session-ingestion.ts';
import type { SourceSet } from '../ingestion/sources.ts';
import { sourceIds } from '../ingestion/source-ids.ts';

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

export function healthOf(parts: HealthParts): Health {
  const { log, projector, stream, ingestion, sources } = parts;
  const backfillComplete = ingestion.backfillComplete && sources.backfillComplete;
  const lastSeq = log.lastSeq();
  const queueDepth = Math.max(0, lastSeq - projector.position) + parts.batcher.pending;
  const skipped = Object.values(projector.skipped.counts).reduce((total, count) => total + count, 0);
  const memory = process.memoryUsage();
  return {
    status: backfillComplete ? 'ok' : 'starting', startedAt: parts.startedAt,
    eventLog: { lastSeq, dbBytes: databaseBytes(parts.dataDir) },
    projection: { position: projector.position, queueDepth, skipped },
    stream: { seq: stream.seq, clients: stream.clients, retained: stream.retained },
    sources: [{ ...ingestion.status, errors: 0 }, ...sources.statuses()],
    backfill: { complete: backfillComplete, windowDays: parts.backfillWindowDays },
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
  };
}

/** What `/settings` may reveal: no paths, no credentials. */
export function settingsOf(config: DaemonConfig & { ingest?: boolean }, port: number): Settings {
  return {
    version: 1, bind: '127.0.0.1', port, backfillWindowDays: config.backfillWindowDays, replayWindow: config.replayWindow,
    webBundle: config.webDist !== undefined, sources: [
      { source: 'session-jsonl', enabled: config.ingest !== false && config.sessionRoots.length > 0 },
      ...sourceIds.map(source => ({ source, enabled: config.ingest !== false && config.sources[source] })),
    ],
  };
}
