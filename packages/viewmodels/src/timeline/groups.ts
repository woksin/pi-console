import type { TimelineLane } from './timeline.ts';

export interface TimelineGroup { repositoryId: string; lanes: TimelineLane[] }

/** Keep repositories in first-seen order and their lanes contiguous, without changing lane data. */
export function timelineGroups(lanes: readonly TimelineLane[], sessions: readonly { id: string; repositoryId: string }[]): TimelineGroup[] {
  const repositories = new Map(sessions.map(session => [session.id, session.repositoryId]));
  const groups = Map.groupBy(lanes, lane => repositories.get(lane.sessionId) ?? 'Unknown repository');
  return [...groups].map(([repositoryId, members]) => ({ repositoryId, lanes: members }));
}

interface LaneName { name: string; lane: string }

/** Inside its repository group the name need not repeat the repository: drop a leading "repo-", "repo:" or "repo " prefix. */
export function withoutRepositoryPrefix<T extends LaneName>(labels: T, repository: string): T {
  const prefix = new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\-_:·/]+`, 'i');
  const name = repository ? labels.name.replace(prefix, '') : labels.name;
  return name && name !== labels.name ? { ...labels, name } : labels;
}
