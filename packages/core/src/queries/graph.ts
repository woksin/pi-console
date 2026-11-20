import type { Graph, GraphEdge, GraphNode } from '@pi-console/contract';
import { compareText } from '../projector/canonical.ts';
import type { ReadModels } from '../projections/index.ts';

type Lanes = ReadModels['lanes']['lanes'];

/** Accumulates nodes and aggregated edges, creating a placeholder node for any lane id it has not seen. */
class GraphBuilder {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();

  addLane(lane: Lanes[string]): void {
    this.nodes.set(lane.id, { laneId: lane.id, label: lane.name, repositoryId: lane.repositoryId });
  }

  add(fromLane: string, toLane: string, kind: GraphEdge['kind'], at: string): void {
    for (const laneId of [fromLane, toLane]) if (!this.nodes.has(laneId)) this.nodes.set(laneId, { laneId, label: laneId, repositoryId: null });
    const key = `${kind}|${fromLane}|${toLane}`;
    const edge = this.edges.get(key) ?? { fromLane, toLane, kind, lastAt: at, count: 0 };
    edge.count++;
    if (at > edge.lastAt) edge.lastAt = at;
    this.edges.set(key, edge);
  }

  /** Edge to another known lane, or nothing when the status names no lane. */
  addStatusEdge(lanes: Lanes, lane: Lanes[string], target: string | null, kind: GraphEdge['kind']): void {
    if (target !== null && target in lanes && lane.statusAt) this.add(lane.id, target, kind, lane.statusAt);
  }
}

/**
 * Lane communication graph: routing data only (lane ids, edge kind, last time, count), never coordinates.
 * Message edges aggregate sent messages between lanes (broadcasts excluded); `waiting-on` and `barred-by` come from
 * the current lane status when it names another known lane. `spawn` needs a session-to-lane link the M1 catalogue
 * does not carry, so it is not produced yet.
 */
export function graphOf(models: ReadModels): Graph {
  const lanes = models.lanes.lanes;
  const graph = new GraphBuilder();
  for (const lane of Object.values(lanes)) graph.addLane(lane);
  for (const message of Object.values(models.messages.messages)) {
    if (message.sentAt !== '' && message.to !== '*') graph.add(message.from, message.to, 'message', message.sentAt);
  }
  for (const lane of Object.values(lanes).filter(candidate => !candidate.closed)) {
    graph.addStatusEdge(lanes, lane, lane.waitingOn, 'waiting-on');
    graph.addStatusEdge(lanes, lane, lane.barredBy, 'barred-by');
  }
  return {
    nodes: [...graph.nodes.values()].sort((a, b) => compareText(a.laneId, b.laneId)),
    edges: [...graph.edges.entries()].sort(([a], [b]) => compareText(a, b)).map(([, edge]) => edge),
  };
}
