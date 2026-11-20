import type { Mapper } from '../tailing/events.ts';
import { list, object, text, timestamp } from '../values.ts';

/** The config is a registry, not a registration timestamp or a status transition. */
export const laneMapper: Mapper = value => {
  const row = object(value);
  if (row.version !== 1) throw new Error('Unknown lanes version');
  list(row.lanes).forEach(lane => text(lane.id));
  return [];
};

export const rosterMapper: Mapper = value => {
  const row = object(value);
  const laneId = text(row.id);
  text(row.cwd);
  timestamp(row.startedAt);
  text(laneId);
  return []; // No human-readable name required by LaneRegistered; no invented fallback.
};

/** Message filenames carry only local HHMM, not an occurrence date. No fabricated timestamp. */
export const laneMessageMapper: Mapper = () => [];
