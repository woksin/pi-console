import { entry, markDirty, orderKey, projection } from '../projector/handlers.ts';

export interface LaneModel {
  id: string;
  name: string;
  repositoryId: string | null;
  cwd?: string | null;
  branch?: string | null;
  metadataKeys?: Partial<Record<'cwd' | 'branch', string>>;
  status: string;
  waitingOn: string | null;
  barredBy: string | null;
  parked: boolean;
  closed: boolean;
  registeredAt: string;
  /** occurredAt of the status now shown. */
  statusAt: string;
  /** orderKey of that status event, so a late older status cannot replace it. */
  statusKey: string;
  issues: string[];
}

export interface LanesState { lanes: Record<string, LaneModel> }

const blank = (id: string, at: string) => (): LaneModel => ({
  id, name: id, repositoryId: null, status: 'unknown', waitingOn: null, barredBy: null, parked: false, closed: false,
  registeredAt: at, statusAt: '', statusKey: '', issues: [], cwd: null, branch: null, metadataKeys: {},
});

export const lanesProjection = projection<LanesState>('lanes', 4, () => ({ lanes: {} }), {
  LaneRegistered(state, payload, event) {
    markDirty(state, 'lanes', payload.laneId);
    const lane = entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt));
    // A roster entry knows no repository: it must not erase the one the lane registry gave.
    Object.assign(lane, { name: payload.name, repositoryId: payload.repositoryId ?? lane.repositoryId });
    const key = orderKey(event);
    const metadataKeys = lane.metadataKeys ??= {};
    for (const field of ['cwd', 'branch'] as const) {
      if (payload[field] === undefined || key < (metadataKeys[field] ?? '')) continue;
      lane[field] = payload[field];
      metadataKeys[field] = key;
    }
  },
  LaneStatusChanged(state, payload, event) {
    markDirty(state, 'lanes', payload.laneId);
    const lane = entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt));
    const key = orderKey(event);
    if (key < lane.statusKey) return;
    Object.assign(lane, { status: payload.status, waitingOn: payload.waitingOn, barredBy: payload.barredBy, parked: payload.parked, statusAt: event.occurredAt, statusKey: key });
  },
  LaneClosed(state, payload, event) { markDirty(state, 'lanes', payload.laneId); entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt)).closed = true; },
  IssueClaimed(state, payload, event) {
    markDirty(state, 'lanes', payload.laneId);
    const lane = entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt));
    if (!lane.issues.includes(payload.issue)) lane.issues.push(payload.issue);
    lane.issues.sort();
  },
}, ['lanes']);
