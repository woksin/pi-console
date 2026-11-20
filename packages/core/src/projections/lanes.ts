import { entry, orderKey, projection } from '../projector/handlers.ts';

export interface LaneModel {
  id: string;
  name: string;
  repositoryId: string | null;
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
  registeredAt: at, statusAt: '', statusKey: '', issues: [],
});

export const lanesProjection = projection<LanesState>('lanes', 1, () => ({ lanes: {} }), {
  LaneRegistered(state, payload, event) {
    Object.assign(entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt)), { name: payload.name, repositoryId: payload.repositoryId });
  },
  LaneStatusChanged(state, payload, event) {
    const lane = entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt));
    const key = orderKey(event);
    if (key < lane.statusKey) return;
    Object.assign(lane, { status: payload.status, waitingOn: payload.waitingOn, barredBy: payload.barredBy, parked: payload.parked, statusAt: event.occurredAt, statusKey: key });
  },
  LaneClosed(state, payload, event) { entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt)).closed = true; },
  IssueClaimed(state, payload, event) {
    const lane = entry(state.lanes, payload.laneId, blank(payload.laneId, event.occurredAt));
    if (!lane.issues.includes(payload.issue)) lane.issues.push(payload.issue);
    lane.issues.sort();
  },
});
