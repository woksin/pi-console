import type { Session } from '@pi-console/contract';
import { sanitize } from './format.ts';

/** Presentation only: preserve raw repository IDs for grouping and routing. */
export function repositoryLabel(repositoryId: string): string {
  return sanitize(repositoryId).split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

const clean = (value: string): string => sanitize(value).trim();
const join = (parts: string[], separator: string): string => parts.filter(Boolean).join(separator);

export function sessionLabels(session: Session) {
  const repository = repositoryLabel(session.repositoryId);
  const lane = session.laneId === 'unassigned' ? '' : clean(session.laneId);
  const branch = clean(session.branch);
  const rawName = clean(session.name);
  const name = lane ? rawName : fallbackName(session, rawName, repository);
  const prefix = `${repository} `;
  const timelineName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return {
    repository, lane, branch, name,
    attention: lane ? join([repository, lane], '/') : name,
    timeline: lane ? join([lane, timelineName], ' ') : name,
    graph: lane ? join([lane, session.role], ' ') : join([name, session.role], ' '),
    title: lane ? join([repository, lane, name], ' / ') : name,
  };
}

function fallbackName(session: Session, name: string, repository: string): string {
  if (name && name !== repository && name !== repositoryLabel(session.cwd) && !/[\\/]/.test(name)) return name;
  const shortId = clean(session.id).slice(0, 8);
  return join([shortId, repository || repositoryLabel(session.cwd) || 'session'], ' ');
}
