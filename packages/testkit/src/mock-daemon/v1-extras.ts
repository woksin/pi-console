// API v1 routes the M0 mock did not have: /graph, /health, /settings and transcript `around` windows.
import type { ELDHistogram } from 'node:perf_hooks';
import type { Graph, GraphEdge } from '@pi-console/contract';
import { HttpError } from './security.ts';
import type { Store } from './store.ts';

type Fixture = Store['fixture'];

/** Lane nodes, counted messages and synthetic status dependencies. No layout data. */
export function graph(fixture: Fixture): Graph {
  const laneOf = new Map(fixture.sessions.map(session => [session.id, session]));
  const nodes = new Map<string, Graph['nodes'][number]>(fixture.sessions.map(session => [session.laneId, { laneId: session.laneId, label: session.laneId, repositoryId: session.repositoryId }]));
  const endpoint = (id: string): string => {
    const laneId = laneOf.get(id)?.laneId ?? id;
    if (!nodes.has(laneId)) nodes.set(laneId, { laneId, label: laneId, repositoryId: null });
    return laneId;
  };
  const edges = [...messageEdges(fixture, endpoint), ...statusEdges(fixture, laneOf)];
  return { nodes: [...nodes.values()], edges };
}

function messageEdges(fixture: Fixture, endpoint: (id: string) => string): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  for (const message of fixture.messages) {
    const from = endpoint(message.fromSessionId);
    const to = endpoint(message.toSessionId);
    const key = `${from}>${to}`;
    const edge = edges.get(key) ?? { fromLane: from, toLane: to, kind: 'message' as const, lastAt: message.sentAt, count: 0 };
    edge.count++;
    if (message.sentAt > edge.lastAt) edge.lastAt = message.sentAt;
    edges.set(key, edge);
  }
  return [...edges.values()];
}

/** Waiting/blocked synthetic sessions name their parent or coordinator as the known dependency lane. */
function statusEdges(fixture: Fixture, sessions: Map<string, Fixture['sessions'][number]>): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  for (const session of fixture.sessions) {
    const kind = session.status === 'waiting' ? 'waiting-on' : session.status === 'blocked' ? 'barred-by' : null;
    if (!kind) continue;
    const target = sessions.get(session.parentSessionId ?? session.orchestratorSessionId);
    if (!target || target.laneId === session.laneId) continue;
    const edge: GraphEdge = { fromLane: session.laneId, toLane: target.laneId, kind, lastAt: session.updatedAt, count: 1 };
    edges.set(`${kind}:${session.laneId}>${target.laneId}`, edge);
  }
  return [...edges.values()];
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
  return { items, nextCursor: items.at(-1)?.cursor ?? 0, hasMore: start + limit < entries.length };
}

export interface MockInfo { port: number; startedAt: string; replayWindow: number; eventLoop: ELDHistogram }

/** Exact-path v1 routes added after M0. */
export const v1Routes = new Map<string, (store: Store, info: MockInfo) => unknown>([
  ['/api/v1/graph', store => graph(store.fixture)],
  ['/api/v1/health', (store, info) => health(store, info.startedAt, info.replayWindow, info.eventLoop)],
  ['/api/v1/settings', (_store, info) => settings(info.port, info.replayWindow)],
]);
