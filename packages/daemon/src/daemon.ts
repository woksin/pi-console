import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ConsoleQueries, consoleProjections, createCompletedWorkRuntime, Projector, readModels, SqliteEventLog, SqliteProjectionStore } from '@pi-console/core';
import type { DaemonConfig } from './config.ts';
import { EventLoopHealth } from './event-loop.ts';
import { apiQuery, type ApiContext } from './api/routes.ts';
import { FileMemoryHandoffs, type MemoryHandoffReader } from './api/memory-handoffs.ts';
import type { TranscriptReader } from './api/transcripts.ts';
import { FileTranscriptReader } from './api/file-transcripts.ts';
import { TranscriptSources } from './api/transcript-sources.ts';
import { healthOf, settingsOf } from './api/health.ts';
import { apiPrefix, authenticate, checkSource, HttpError, streamPath } from './security/guard.ts';
import { Credentials, loadToken } from './security/token.ts';
import { MemoryActions } from './memory/actions.ts';
import { isMemoryApiPath, memoryApi } from './memory/api.ts';
import { baseHeaders, sendError, sendJson } from './http/output.ts';
import { serveStatic } from './http/static-files.ts';
import { StreamHub } from './stream/stream-hub.ts';
import { DeltaBatcher } from './stream/delta-batcher.ts';
import { streamSequence } from './stream/stream-sequence.ts';
import { CheckpointCache } from './ingestion/checkpoint-cache.ts';
import { SessionIngestion } from './ingestion/session-ingestion.ts';
import { sourceSetFor, type SourceSet } from './ingestion/sources.ts';

export interface DaemonOptions extends DaemonConfig {
  /** Start polling session files. Specs that append to the log directly turn this off. */
  ingest?: boolean;
  transcripts?: TranscriptReader;
  /** Reads memory figures from handoff files on demand; the default reads the real files under the safety rules. */
  memoryHandoffs?: MemoryHandoffReader;
  /** Unsent SSE bytes per client before it is disconnected (default 1 MiB). */
  maxBufferedBytes?: number;
  now?: () => Date;
}

export interface RunningDaemon {
  port: number;
  address: string;
  log: SqliteEventLog;
  stream: StreamHub;
  ingestion: SessionIngestion;
  /** The other sources (context, lanes, questions, issues, phases), each under its own supervisor. */
  sources: SourceSet;
  /** Milliseconds from start until the API answered with caught-up read models. */
  startupMs: number;
  close(): Promise<void>;
}

interface Core { log: SqliteEventLog; store: SqliteProjectionStore; projector: Projector }

type Cleanup = () => void | Promise<void>;

async function rollback(cleanups: Cleanup[]): Promise<void> {
  for (const cleanup of cleanups.reverse()) {
    try { await cleanup(); }
    catch { process.stderr.write('pi-console: startup cleanup failed\n'); }
  }
}

async function openCore(dataDir: string, cleanups: Cleanup[]): Promise<Core> {
  const path = join(dataDir, 'console.db');
  const log = new SqliteEventLog(path);
  cleanups.push(() => { log.close(); });
  const store = new SqliteProjectionStore(path);
  cleanups.push(() => { store.close(); });
  const projector = new Projector(log, consoleProjections(), store, { work: createCompletedWorkRuntime(store) });
  cleanups.push(() => { projector.stop(); });
  await projector.start();
  return { log, store, projector };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as { port: number }).port);
    });
  });
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

interface HandlerParts { port: () => number; credentials: Credentials; api: ApiContext; stream: StreamHub; webDist: string | undefined; actions: () => MemoryActions | undefined }

async function api(parts: HandlerParts, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  authenticate(req, url, parts.credentials);
  if (isMemoryApiPath(url)) {
    await memoryApi(parts, req, res, url);
    return;
  }
  if (req.method === 'GET' && url.pathname === streamPath) {
    const lastEventId = req.headers['last-event-id'];
    parts.stream.connect(res, Array.isArray(lastEventId) ? lastEventId[0] : lastEventId);
    return;
  }
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  sendJson(res, 200, await apiQuery(parts.api, url));
}

function handler(parts: HandlerParts): Handler {
  return async (req, res) => {
    baseHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      checkSource(req, parts.port());
      if (url.pathname === apiPrefix || url.pathname.startsWith(`${apiPrefix}/`)) await api(parts, req, res, url);
      else if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
      else await serveStatic(parts.webDist, req, res, url);
    } catch (error) {
      sendError(res, error);
    }
  };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>(resolve => { server.close(() => { resolve(); }); });
}

function createHttpServer(handle: Handler): Server {
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => { void handle(req, res); });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

/**
 * Starts the read-only console daemon: event log and projector in `<dataDir>/console.db`, session and source ingestion in the
 * background, and the API v1 over plain `node:http` on 127.0.0.1 (ADR-0002 addendum, docs/api/v1.md).
 */
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const cleanups: Cleanup[] = [];
  try { return await openDaemon(options, cleanups); }
  catch (error) {
    await rollback(cleanups);
    throw error;
  }
}

async function openDaemon(options: DaemonOptions, cleanups: Cleanup[]): Promise<RunningDaemon> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const now = options.now ?? (() => new Date());
  const control = options.memoryActions ? loadToken(options.dataDir, 'memory-control-token') : undefined;
  const credentials = new Credentials(loadToken(options.dataDir), control);
  const { log, store, projector } = await openCore(options.dataDir, cleanups);
  const queries = () => new ConsoleQueries(() => readModels(projector), now);
  const stream = new StreamHub({
    ...streamSequence(store, projector.position), ringSize: options.replayWindow, heartbeatMs: options.heartbeatMs,
    maxBufferedBytes: options.maxBufferedBytes ?? 1024 * 1024, snapshot: activeOnly => {
      batcher.rebase();
      return queries().screenSnapshot(now().toISOString(), activeOnly ? 0 : undefined);
    },
    now,
    warn: message => { process.stderr.write(`pi-console: ${message}\n`); },
  });
  cleanups.push(() => { stream.close(); });
  const batcher = new DeltaBatcher(() => readModels(projector), delta => { stream.publish(delta.type, delta.payload); }, now, {
    discard: () => stream.invalidateIfIdle(),
  });
  cleanups.push(() => { batcher.flush(); });
  const stopDeltas = projector.onApplied(event => { batcher.add(event); });
  cleanups.push(stopDeltas);
  const checkpoints = new CheckpointCache(log);
  const fileTranscripts = new FileTranscriptReader(new TranscriptSources(checkpoints, options.sessionRoots));
  cleanups.push(() => fileTranscripts.close());
  const ingestion = new SessionIngestion(checkpoints, { roots: options.sessionRoots, backfillWindowDays: options.backfillWindowDays, pollMs: options.pollMs, now });
  cleanups.push(() => ingestion.stop());
  const sources = sourceSetFor(log, options, now);
  cleanups.push(() => sources.stop());
  let port = options.port;
  const eventLoop = new EventLoopHealth();
  cleanups.push(() => { eventLoop.close(); });
  const apiContext: ApiContext = {
    queries, transcripts: options.transcripts ?? fileTranscripts, memoryHandoffs: options.memoryHandoffs ?? new FileMemoryHandoffs(),
    health: () => healthOf({ startedAt, dataDir: options.dataDir, log, projector, stream, ingestion, sources, batcher, backfillWindowDays: options.backfillWindowDays, eventLoop: eventLoop.read(), config: options }),
    settings: () => settingsOf(options, port),
  };
  let actions: MemoryActions | undefined;
  const server = createHttpServer(handler({ port: () => port, credentials, api: apiContext, stream, webDist: options.webDist, actions: () => actions }));
  cleanups.push(() => closeServer(server));
  if (control !== undefined) {
    actions = new MemoryActions({ config: options, server, secret: control, queries, models: () => readModels(projector), log });
    const acquired = actions;
    cleanups.push(() => { acquired.close(); });
  } else server.on('upgrade', (_req, socket) => { socket.destroy(); });
  port = await listen(server, options.port);
  actions?.port(port);
  if (options.ingest !== false) {
    ingestion.start();
    sources.start(() => ingestion.backfillComplete);
  }
  return {
    port, address: '127.0.0.1', log, stream, ingestion, sources, startupMs: performance.now() - started,
    async close() {
      await Promise.all([sources.stop(), ingestion.stop(), fileTranscripts.close()]);
      batcher.flush();
      stream.close();
      actions?.close();
      await closeServer(server);
      stopDeltas();
      projector.stop();
      store.close();
      log.close();
      eventLoop.close();
    },
  };
}
