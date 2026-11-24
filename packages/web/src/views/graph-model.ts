import type { GraphEdge } from '@pi-console/contract';
import { graphViewModel, repositoryLabel, sessionLabels, type SessionLabel, type GraphEdgeView, type StatusCell } from '@pi-console/viewmodels';
import type { ConsoleState } from '../state/state.ts';

/** `label` is the short identity (lane ID); `name` is the readable second line, or null when the lane has no name beyond its ID. */
export interface WebGraphNode { id: string; label: string; name: string | null; sessionId: string | null; status: StatusCell | null; identity?: SessionLabel }
export interface WebGraphGroup {
  id: string;
  title: string;
  summary: string;
  nodes: WebGraphNode[];
  edges: (Omit<GraphEdgeView, 'kind'> & { kind: GraphEdge['kind'] })[];
}

/** Lane communication is authoritative; session identity is used only for the separate spawn overlay. */
export function webGraphModel(state: Pick<ConsoleState, 'graph' | 'sessions'>, upTo = Infinity) {
  const source = state.graph ?? { nodes: [], edges: [] };
  const graph = { ...source, edges: source.edges.filter(edge => Date.parse(edge.lastAt) <= upTo) };
  const lanes: WebGraphGroup[] = graphViewModel({ graph }).groups.map(group => ({
    id: `lanes:${group.repositoryId ?? 'unassigned'}`, title: group.repositoryId === null ? 'Unassigned lanes' : repositoryLabel(group.repositoryId), summary: `${String(group.messages)} messages`,
    nodes: group.nodes.map(node => ({ id: node.laneId, label: node.laneId, name: node.label === node.laneId ? null : node.label, sessionId: null, status: null })),
    edges: group.edges.map(edge => ({ ...edge, from: edge.fromLane, to: edge.toLane })),
  }));
  const identities = new Map(state.sessions.map(session => [session.id, sessionLabels(session)]));
  const sessions: WebGraphGroup[] = graphViewModel({ sessions: state.sessions, messages: [] }).groups.filter(group => group.edges.length > 0).map(group => {
    const endpoints = new Set(group.edges.flatMap(edge => [edge.from, edge.to]));
    return {
      id: `sessions:${group.repositoryId}`, title: repositoryLabel(group.repositoryId), summary: `${String(group.edges.length)} spawn links`,
      nodes: group.nodes.filter(node => endpoints.has(node.sessionId)).map(node => ({
        id: node.sessionId, label: node.label, name: null, sessionId: node.sessionId, status: node.status, identity: identities.get(node.sessionId),
      })),
      edges: group.edges,
    };
  });
  return { lanes, sessions };
}
