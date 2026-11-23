import type { Graph, GraphEdge, GraphNode, Message, Session } from '@pi-console/contract';
import { sessionLabels } from '../format/session-labels.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export type EdgeKind = 'message' | 'spawn';
export interface GraphNodeView { sessionId: string; label: string; status: StatusCell; role: Session['role'] }
export interface GraphEdgeView { from: string; to: string; kind: EdgeKind; count: number; lastAt: string; thickness: 1 | 2 | 3 }
export interface GraphGroup { repositoryId: string; nodes: GraphNodeView[]; edges: GraphEdgeView[]; messages: number }
export interface GraphViewModel { groups: GraphGroup[] }

const thickness = (count: number): 1 | 2 | 3 => (count >= 6 ? 3 : count >= 2 ? 2 : 1);

export type LaneGraphEdgeView = GraphEdge & { thickness: 1 | 2 | 3 };
export interface LaneGraphGroup {
  repositoryId: string | null; nodes: GraphNode[]; edges: LaneGraphEdgeView[]; messages: number;
}
export interface LaneGraphViewModel { groups: LaneGraphGroup[] }

function laneGraphViewModel(graph: Graph): LaneGraphViewModel {
  const nodes = new Map(graph.nodes.map(node => [node.laneId, node]));
  const groups = new Map<string | null, LaneGraphGroup>();
  const groupFor = (repositoryId: string | null): LaneGraphGroup => {
    let group = groups.get(repositoryId);
    if (!group) { group = { repositoryId, nodes: [], edges: [], messages: 0 }; groups.set(repositoryId, group); }
    return group;
  };
  for (const node of graph.nodes) groupFor(node.repositoryId).nodes.push(node);
  for (const edge of graph.edges) {
    const group = groupFor(nodes.get(edge.fromLane)?.repositoryId ?? null);
    group.edges.push({ ...edge, thickness: thickness(edge.count) });
    if (edge.kind === 'message') group.messages += edge.count;
    addLaneEndpoint(group, nodes, edge.fromLane);
    addLaneEndpoint(group, nodes, edge.toLane);
  }
  return { groups: [...groups.values()] };
}

function addLaneEndpoint(group: LaneGraphGroup, nodes: Map<string, GraphNode>, laneId: string): void {
  if (!group.nodes.some(node => node.laneId === laneId)) group.nodes.push(nodes.get(laneId) ?? { laneId, label: laneId, repositoryId: null });
}

/** Canonical lane input; the legacy session input remains available for web and session relationships. */
export function graphViewModel(input: { graph: Graph }): LaneGraphViewModel;
export function graphViewModel(input: { sessions: readonly Session[]; messages: readonly Message[] }): GraphViewModel;
export function graphViewModel(input: { graph: Graph } | { sessions: readonly Session[]; messages: readonly Message[] }): LaneGraphViewModel | GraphViewModel {
  return 'graph' in input ? laneGraphViewModel(input.graph) : sessionGraphViewModel(input);
}

/**
 * Communication graph as edge data per repository: message edges aggregated per ordered pair, spawn edges from
 * `parentSessionId`. No layout is computed here (the API serves edge data only); clients lay it out.
 */
function sessionGraphViewModel(input: { sessions: readonly Session[]; messages: readonly Message[] }): GraphViewModel {
  const byId = new Map(input.sessions.map(session => [session.id, session]));
  const edges = new Map<string, GraphEdgeView & { repositoryId: string }>();
  const touch = (from: Session, to: Session, kind: EdgeKind, at: string) => {
    const key = `${kind}:${from.id}>${to.id}`;
    const edge = edges.get(key) ?? { from: from.id, to: to.id, kind, count: 0, lastAt: at, thickness: 1 as const, repositoryId: from.repositoryId };
    edges.set(key, { ...edge, count: edge.count + 1, lastAt: at > edge.lastAt ? at : edge.lastAt });
  };
  for (const session of input.sessions) {
    const parent = session.parentSessionId ? byId.get(session.parentSessionId) : undefined;
    if (parent) touch(parent, session, 'spawn', session.startedAt);
  }
  for (const message of input.messages) {
    const from = byId.get(message.fromSessionId);
    const to = byId.get(message.toSessionId);
    if (from && to) touch(from, to, 'message', message.sentAt);
  }
  const groups = Map.groupBy(input.sessions, session => session.repositoryId);
  return {
    groups: [...groups].map(([repositoryId, sessions]) => {
      const repositoryEdges = [...edges.values()].filter(edge => edge.repositoryId === repositoryId).map(edge => ({ from: edge.from, to: edge.to, kind: edge.kind, count: edge.count, lastAt: edge.lastAt, thickness: thickness(edge.count) }));
      const touched = new Set(repositoryEdges.flatMap(edge => [edge.from, edge.to]));
      return {
        repositoryId, edges: repositoryEdges.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from)),
        nodes: sessions.filter(session => touched.has(session.id)).map(session => ({ sessionId: session.id, label: sessionLabels(session).graph, status: statusCell(session.status), role: session.role })),
        messages: repositoryEdges.filter(edge => edge.kind === 'message').reduce((sum, edge) => sum + edge.count, 0),
      };
    }).filter(group => group.edges.length > 0),
  };
}
