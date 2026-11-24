import type { TimelineLane } from '@pi-console/viewmodels';

export const laneHeight = 34;
export const groupHeight = 28;

/** Web-only layout: repository headers and contiguous lanes; shared timeline data stays unchanged. */
export function timelineGroups(lanes: readonly TimelineLane[], sessions: readonly { id: string; repositoryId: string }[]) {
  const repositories = new Map(sessions.map(session => [session.id, session.repositoryId]));
  const groups = Map.groupBy(lanes, lane => repositories.get(lane.sessionId) ?? 'Unknown repository');
  let top = 30;
  return [...groups].map(([repositoryId, members]) => {
    const group = { repositoryId, lanes: members, top };
    top += groupHeight + members.length * laneHeight;
    return group;
  });
}

interface LaneName { name: string; lane: string }

/** Inside its repository group the name need not repeat the repository: drop a leading "repo-", "repo:" or "repo " prefix. */
export function withoutRepositoryPrefix<T extends LaneName>(labels: T, repository: string): T {
  const prefix = new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\-_:·/]+`, 'i');
  const name = repository ? labels.name.replace(prefix, '') : labels.name;
  return name && name !== labels.name ? { ...labels, name } : labels;
}

const minLabelWidth = 170;
const maxLabelWidth = 340;
const cellPixels = 8;
const labelChrome = 32;

/** Label column in viewBox units: wide enough for the longest lane label, within bounds, so the lane id is never the part that is cut. */
export function labelColumnWidth(fullLabelWidths: readonly number[]): number {
  const widest = Math.max(0, ...fullLabelWidths);
  return Math.min(maxLabelWidth, Math.max(minLabelWidth, labelChrome + widest * cellPixels));
}

export const labelCellsFor = (labelWidth: number): number => Math.floor((labelWidth - labelChrome) / cellPixels);
