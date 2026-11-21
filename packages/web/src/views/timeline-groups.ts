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
