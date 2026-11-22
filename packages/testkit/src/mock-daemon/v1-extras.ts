// API v1 routes the M0 mock did not have: /graph, /health, /settings and transcript `around` windows.
import type { ELDHistogram } from 'node:perf_hooks';
import { HttpError } from './security.ts';
import type { Store } from './store.ts';

type Fixture = Store['fixture'];

/** Lane nodes and message edges between lanes, aggregated with count and last time. No layout data. */
export function graph(fixture: Fixture) {
  const laneOf = new Map(fixture.sessions.map(session => [session.id, session]));
  const nodes = [...new Map(fixture.sessions.map(session => [session.laneId, { laneId: session.laneId, label: session.laneId, repositoryId: session.repositoryId }])).values()];
  const edges = new Map<string, { fromLane: string; toLane: string; kind: 'message'; lastAt: string; count: number }>();
  for (const message of fixture.messages) {
    const from = laneOf.get(message.fromSessionId)?.laneId;
    const to = laneOf.get(message.toSessionId)?.laneId;
    if (!from || !to) continue;
    const key = `${from}>${to}`;
    const edge = edges.get(key) ?? { fromLane: from, toLane: to, kind: 'message' as const, lastAt: message.sentAt, count: 0 };
    edge.count++;
    if (message.sentAt > edge.lastAt) edge.lastAt = message.sentAt;
    edges.set(key, edge);
  }
  return { nodes, edges: [...edges.values()] };
}

export function health(store: Store, startedAt: string, replayWindow: number, histogram: ELDHistogram) {
  const memory = process.memoryUsage();
  return {
    status: 'ok', startedAt, eventLog: { lastSeq: store.seq(), dbBytes: 0 },
    projection: { position: store.seq(), queueDepth: 0, skipped: 0 },
    eventLoop: histogram.count === 0 ? { p50: 0, p99: 0, max: 0 } : {
      p50: histogram.percentile(50) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6,
    },
    stream: { seq: store.seq(), clients: store.clients(), retained: Math.min(store.seq(), replayWindow) },
    sources: [], backfill: { complete: true, windowDays: 14 },
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
  };
}

export function settings(port: number, replayWindow: number) {
  return { version: 1, bind: '127.0.0.1', port, backfillWindowDays: 14, replayWindow, webBundle: false, sources: [{ source: 'mock', enabled: true }] };
}

/** `limit` entries centred on `entryId`; unknown entries are 404. */
export function transcriptAround(store: Store, sessionId: string, entryId: string, limit: number) {
  const entries = store.fixture.transcript.filter(entry => entry.sessionId === sessionId);
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) throw new HttpError(404, 'Transcript entry not found');
  const start = Math.max(0, index - Math.floor(limit / 2));
  const items = entries.slice(start, start + limit);
  return { items, nextCursor: items.at(-1)?.cursor ?? 0, hasMore: start + limit < entries.length, hasOlder: start > 0 };
}

export interface MockInfo { port: number; startedAt: string; replayWindow: number; eventLoop: ELDHistogram }

/** Exact-path v1 routes added after M0. */
export const v1Routes = new Map<string, (store: Store, info: MockInfo) => unknown>([
  ['/api/v1/graph', store => graph(store.fixture)],
  ['/api/v1/health', (store, info) => health(store, info.startedAt, info.replayWindow, info.eventLoop)],
  ['/api/v1/settings', (_store, info) => settings(info.port, info.replayWindow)],
]);
