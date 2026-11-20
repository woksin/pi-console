import type { Graph, GraphEdge, GraphNode } from '@pi-console/contract';
import { compareText } from '../projector/canonical.ts';
import type { ReadModels } from '../projections/index.ts';

/**
 * Lane communication graph: routing data only (lane ids, edge kind, last time, count), never coordinates.
 * Message edges aggregate sent messages between lanes (broadcasts excluded); `waiting-on` and `barred-by` come from
 * the current lane status when it names another known lane. `spawn` needs a session-to-lane link the M1 catalogue
 * does not carry, so it is not produced yet.
 */
export function graphOf(models: ReadModels): Graph {
  const lanes = models.lanes.lanes;
  const nodes = new Map<string, GraphNode>();
  for (const lane of Object.values(lanes)) nodes.set(lane.id, { laneId: lane.id, label: lane.name, repositoryId: lane.repositoryId });
  const edges = new Map<string, GraphEdge>();
  const add = (fromLane: string, toLane: string, kind: GraphEdge['kind'], at: string) => {
    for (const laneId of [fromLane, toLane]) if (!nodes.has(laneId)) nodes.set(laneId, { laneId, label: laneId, repositoryId: null });
    const key = `${kind}|${fromLane}|${toLane}`;
    const edge = edges.get(key) ?? { fromLane, toLane, kind, lastAt: at, count: 0 };
    edge.count++;
    if (at > edge.lastAt) edge.lastAt = at;
    edges.set(key, edge);
  };
  for (const message of Object.values(models.messages.messages)) {
    if (message.sentAt !== '' && message.to !== '*') add(message.from, message.to, 'message', message.sentAt);
  }
  for (const lane of Object.values(lanes)) {
    if (lane.closed || !lane.statusAt) continue;
    if (lane.waitingOn !== null && lane.waitingOn in lanes) add(lane.id, lane.waitingOn, 'waiting-on', lane.statusAt);
    if (lane.barredBy !== null && lane.barredBy in lanes) add(lane.id, lane.barredBy, 'barred-by', lane.statusAt);
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => compareText(a.laneId, b.laneId)),
    edges: [...edges.entries()].sort(([a], [b]) => compareText(a, b)).map(([, edge]) => edge),
  };
}
