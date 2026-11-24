import type { Session } from '@pi-console/contract';
import { clip, displayWidth, sanitize, type TextWidth } from './format.ts';

/** Presentation only: preserve raw repository IDs for grouping and routing. */
export function repositoryLabel(repositoryId: string): string {
  return sanitize(repositoryId).split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

type SessionIdentity = Pick<Session, 'id' | 'name'> & Partial<Pick<Session, 'repositoryId' | 'laneId' | 'branch' | 'cwd'>>;

const clean = (value = ''): string => sanitize(value).trim();
const distinctLane = (lane: string, name: string): string => lane === name ? '' : lane;

/** One identity everywhere: readable name first, lane second; absent values never leak sentinel IDs or cwd paths. */
export function sessionLabels(session: SessionIdentity) {
  const repository = repositoryLabel(session.repositoryId ?? '');
  const rawLane = clean(session.laneId);
  const lane = rawLane === 'unassigned' ? '' : rawLane;
  const rawName = clean(session.name);
  const readable = readableName(session, rawName, lane, repository);
  const name = readable || lane || clean(session.id).slice(0, 8);
  const secondary = distinctLane(lane, name);
  const title = secondary ? `${name} · ${secondary}` : name;
  const branch = clean(session.branch);
  return { repository, lane, name, branch, attention: title, timeline: title, graph: title, title };
}

/** Keep lane identity intact; only the readable name may be shortened to fit terminal cells. */
export function fitSessionLabel({ name, lane }: Pick<ReturnType<typeof sessionLabels>, 'name' | 'lane'>, width: number, measure: TextWidth = displayWidth): string {
  if (!lane) return clip(name, width, measure);
  if (!name || name === lane) return lane;
  const suffix = ` · ${lane}`;
  const nameWidth = width - measure(suffix);
  return nameWidth > 0 ? `${clip(name, nameWidth, measure)}${suffix}` : lane;
}

function readableName(session: SessionIdentity, name: string, lane: string, repository: string): string {
  if (name === session.id || /[\\/]/.test(name)) return '';
  if (!lane && [repository, repositoryLabel(session.cwd ?? '')].includes(name)) return '';
  return name;
}
