import type { Fact, Mapper } from '../tailing/events.ts';
import { list, object, text, timestamp } from '../values.ts';

/** Refresh existing registry snapshots once without resetting their checkpoints. */
export const laneMapperVersion = 'lane-identity-v1';

function registryMetadata(lane: Record<string, unknown>): Record<string, string | null> {
  const metadata: Record<string, string | null> = {};
  for (const key of ['cwd', 'branch'] as const) {
    if (lane[key] !== undefined) metadata[key] = lane[key] === null ? null : text(lane[key]);
  }
  return metadata;
}

const laneName = /^[A-Z][A-Z0-9-]{0,15}$/;
const iso = '(\\S+)';
const working = new RegExp(`^working since ${iso}$`);
const waiting = new RegExp(`^(waiting-on|barred-by|parked) "([^"]+)" until ${iso}$`);
const closed = new RegExp(`^closed(?: reassigned-to [A-Z][A-Z0-9-]{0,15})? at ${iso}(?: reason ".*")?$`);

const registered = (laneId: string, repositoryId: string | null, at?: string): Fact => ({
  type: 'LaneRegistered', subject: `lane:${laneId}`, payload: { laneId, name: laneId, repositoryId }, entryId: laneId, observationId: laneId, occurredAt: at,
});

const closure = (laneId: string, at: string): Fact => ({ type: 'LaneClosed', subject: `lane:${laneId}`, payload: { laneId }, entryId: laneId, observationId: laneId, occurredAt: timestamp(at) });

const statusFact = (laneId: string, status: string, dependency: string | null): Fact => ({
  type: 'LaneStatusChanged', subject: `lane:${laneId}`, entryId: laneId, observationId: laneId,
  payload: { laneId, status, waitingOn: status === 'barred-by' ? null : dependency, barredBy: status === 'barred-by' ? dependency : null, parked: status === 'parked' },
});

/**
 * One lane-status line (`lane-status` tool grammar), decoded by the daemon to `{ lane, line }`. `until` is a deadline
 * and the closing reason and target are free text: none of them is carried. Without an occurrence time the status takes
 * the file's write time (the writer replaces the file atomically). Anything else throws, which becomes a body-free warning.
 */
export const laneStatusMapper: Mapper = value => {
  const lane = text(value.lane);
  const line = text(value.line);
  if (!laneName.test(lane)) throw new Error('Unknown lane name');
  const start = working.exec(line);
  if (start) return [{ ...statusFact(lane, 'working', null), occurredAt: timestamp(start[1]) }];
  const wait = waiting.exec(line);
  if (wait) {
    timestamp(wait[3]);
    return [statusFact(lane, wait[1], wait[2])];
  }
  const end = closed.exec(line);
  if (end) return [closure(lane, end[1])];
  throw new Error('Unknown lane status line');
};

/** `lanes.json`: identity metadata is allowlisted; prompts and arbitrary producer fields never leave the file. */
export const laneMapper: Mapper = value => {
  const row = object(value);
  if (row.version !== 1) throw new Error('Unknown lanes version');
  return list(row.lanes).flatMap(lane => {
    const id = text(lane.id);
    const repo = lane.repo === undefined || lane.repo === null ? null : text(lane.repo);
    const end = lane.closed === undefined || lane.closed === null ? undefined : timestamp(object(lane.closed).at);
    const fact = registered(id, repo);
    Object.assign(fact.payload, registryMetadata(lane));
    return [fact, ...(end ? [closure(id, end)] : [])];
  });
};

/** A session's roster entry registers the lane at its start. A retirement is a session ending, not a lane closing. */
export const rosterMapper: Mapper = value => {
  const row = object(value);
  return [registered(text(row.id), null, timestamp(row.startedAt))];
};

/** Message filenames carry only local HHMM, not an occurrence date. No fabricated timestamp. */
export const laneMessageMapper: Mapper = () => [];
