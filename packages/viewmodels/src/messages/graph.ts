import type { Message, Session } from '@pi-console/contract';
import { age, badge, pressure, type Badge, type Pressure } from '../common/format.ts';
import { displayStatus } from '../common/sessions.ts';
import { sessionLabel, sessionById, repositoryName, type ConsoleState } from '../state/index.ts';
import { deliveryToken, messageRow, type DeliveryToken, type MessageRow } from './list.ts';

export const graphSize = { width: 1000, height: 640 } as const;

export type GraphSelection = { kind: 'node' | 'edge'; id: string } | null;

export interface GraphContext {
  /** Visible window length in ms (default 1 hour). */
  windowMs?: number;
  /** Scrubber position (epoch ms); null follows live. */
  until?: number | null;
  selection?: GraphSelection;
  /** A message is "recent" (edge pulses) when sent within this many ms of the scrub position. */
  pulseMs?: number;
}

export interface GraphNodeView {
  id: string; label: string; laneId: string; repository: string; hub: boolean; x: number; y: number; r: number;
  badge: Badge; pressure: Pressure; attention: boolean; selected: boolean;
}

export interface GraphEdgeView {
  id: string; from: string; to: string; kind: 'message' | 'spawn'; count: number; lastAt: string; age: string;
  delivery: DeliveryToken; unread: number; recent: boolean; selected: boolean;
}

export interface GraphViewModel {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  /** Nodes with no edge in the window, collapsed into a count (large fleets). */
  idleCount: number;
  window: { start: number; end: number; live: boolean; min: number; max: number };
  detail: { title: string; messages: MessageRow[] };
  empty: boolean;
  legend: { label: string; glyph: string }[];
}

const isHub = (session: Session): boolean => session.role === 'orchestrator' || session.orchestratorSessionId === session.id;

function windowMessages(state: ConsoleState, until: number, windowMs: number): Message[] {
  return state.messages.filter(message => {
    const at = Date.parse(message.sentAt);
    return at <= until && at > until - windowMs;
  });
}

const deliveryRank = { sent: 0, delivered: 1, read: 2 } as const;

function aggregate(messages: readonly Message[], until: number, pulseMs: number): Omit<GraphEdgeView, 'age' | 'selected'>[] {
  const pairs = new Map<string, Message[]>();
  for (const message of messages) {
    const key = `${message.fromSessionId}>${message.toSessionId}`;
    pairs.set(key, [...pairs.get(key) ?? [], message]);
  }
  return [...pairs.entries()].map(([id, items]) => {
    const last = items.reduce((newest, item) => item.sentAt > newest.sentAt ? item : newest);
    return {
      id, from: last.fromSessionId, to: last.toSessionId, kind: 'message' as const, count: items.length, lastAt: last.sentAt,
      delivery: deliveryToken(items.reduce<Message['status']>((best, item) => deliveryRank[item.status] > deliveryRank[best] ? item.status : best, 'sent')),
      unread: items.filter(item => item.status !== 'read').length, recent: until - Date.parse(last.sentAt) <= pulseMs,
    };
  }).toSorted((a, b) => a.id.localeCompare(b.id));
}

/** Deterministic hub-and-spoke layout: orchestrators on an outer ring, their sessions on a small ring around each hub. */
export function layout(state: ConsoleState, ids: readonly string[]): Map<string, { x: number; y: number; hub: boolean }> {
  const sessions = ids.map(id => sessionById(state, id)).filter((session): session is Session => session !== undefined);
  const groups = new Map<string, Session[]>();
  for (const session of sessions) groups.set(session.orchestratorSessionId, [...groups.get(session.orchestratorSessionId) ?? [], session]);
  const keys = [...groups.keys()].toSorted();
  const result = new Map<string, { x: number; y: number; hub: boolean }>();
  keys.forEach((key, index) => { placeGroup(result, groups.get(key) ?? [], index, keys.length); });
  return result;
}

function placeGroup(result: Map<string, { x: number; y: number; hub: boolean }>, group: readonly Session[], index: number, groups: number): void {
  const centre = { x: graphSize.width / 2, y: graphSize.height / 2 };
  const angle = -Math.PI / 2 + index / groups * 2 * Math.PI;
  const hub = groups > 1 ? { x: centre.x + Math.cos(angle) * 300, y: centre.y + Math.sin(angle) * 222 } : centre;
  const members = group.toSorted((a, b) => a.id.localeCompare(b.id));
  const leader = members.find(isHub);
  if (leader) result.set(leader.id, { ...round(hub), hub: true });
  const others = members.filter(member => member !== leader);
  const radius = groups > 1 ? 112 : 190;
  others.forEach((member, slot) => {
    const spread = angle + (slot + 0.5) / others.length * 2 * Math.PI;
    result.set(member.id, { ...round({ x: hub.x + Math.cos(spread) * radius, y: hub.y + Math.sin(spread) * radius * 0.8 }), hub: false });
  });
}

const round = (point: { x: number; y: number }) => ({ x: Math.round(point.x), y: Math.round(point.y) });

function nodeViews(state: ConsoleState, ids: Set<string>, selection: GraphSelection): GraphNodeView[] {
  const placed = layout(state, [...ids]);
  return [...ids].toSorted().flatMap(id => {
    const session = sessionById(state, id);
    const place = placed.get(id);
    if (!session || !place) return [];
    const level = pressure(session.contextPercent);
    return [{
      id, label: session.laneId, laneId: session.laneId, repository: repositoryName(state, session.repositoryId), ...place,
      r: Math.round((place.hub ? 17 : 11) + session.contextPercent / 100 * 7), badge: badge(displayStatus(state, session)), pressure: level,
      attention: state.needsYou.some(item => item.sessionId === id), selected: selection?.kind === 'node' && selection.id === id,
    }];
  });
}

function detailFor(state: ConsoleState, messages: readonly Message[], selection: GraphSelection): GraphViewModel['detail'] {
  const pick = (message: Message) => {
    if (selection?.kind === 'node') return message.fromSessionId === selection.id || message.toSessionId === selection.id;
    if (selection?.kind === 'edge') return `${message.fromSessionId}>${message.toSessionId}` === selection.id;
    return true;
  };
  const chosen = messages.filter(pick).toSorted((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 8);
  const title = selection?.kind === 'node' ? sessionLabel(state, selection.id)
    : selection?.kind === 'edge' ? selection.id.split('>').map(id => sessionLabel(state, id)).join(' → ') : 'Latest messages';
  return { title, messages: chosen.map(message => messageRow(state, message)) };
}

const legend = [
  { glyph: '○', label: 'sent' }, { glyph: '◐', label: 'delivered' }, { glyph: '●', label: 'read' },
  { glyph: '╌', label: 'spawned subagent' }, { glyph: '◦', label: 'new message pulse' },
];

export function buildGraph(state: ConsoleState, context: GraphContext = {}): GraphViewModel {
  const windowMs = context.windowMs ?? 3_600_000;
  const max = state.liveAt;
  const until = Math.min(context.until ?? max, max);
  const selection = context.selection ?? null;
  const messages = windowMessages(state, until, windowMs);
  const edges = aggregate(messages, until, context.pulseMs ?? 8000);
  const ids = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const spawn = state.sessions.filter(session => session.parentSessionId && ids.has(session.parentSessionId) && ids.has(session.id));
  const spawnEdges = spawn.map(session => ({
    id: `${session.parentSessionId ?? ''}>${session.id}:spawn`, from: session.parentSessionId ?? '', to: session.id, kind: 'spawn' as const,
    count: 1, lastAt: session.startedAt, delivery: deliveryToken('read'), unread: 0, recent: false,
  }));
  const all = [...edges, ...spawnEdges].map(edge => ({
    ...edge, age: age(until, edge.lastAt), selected: selection?.kind === 'edge' && selection.id === edge.id,
  }));
  return {
    nodes: nodeViews(state, ids, selection), edges: all, idleCount: state.sessions.filter(session => !ids.has(session.id)).length,
    window: { start: until - windowMs, end: until, live: context.until === undefined || context.until === null || context.until >= max, min: Math.min(...state.messages.map(message => Date.parse(message.sentAt)), max), max },
    detail: detailFor(state, messages, selection), empty: edges.length === 0, legend,
  };
}
