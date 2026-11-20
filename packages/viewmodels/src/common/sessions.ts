import type { Session } from '@pi-console/contract';
import { badge, pressure, sparkline, age, type Badge, type Pressure } from './format.ts';
import { repositoryName, type ConsoleState } from '../state/index.ts';

/** Session badge precedence (information-architecture section 2): Needs you, Blocked, Failed, Interrupted, Working, Waiting, Idle. */
export function displayStatus(state: ConsoleState, session: Session): string {
  const needsAttention = state.needsYou.some(item => item.sessionId === session.id);
  if (needsAttention || session.status === 'needs-you') return 'needs-you';
  if (session.status === 'blocked' || session.status === 'failed') return session.status;
  if (state.requests.some(request => request.sessionId === session.id && request.status === 'interrupted' && request.origin !== 'unproven')) return 'interrupted';
  return session.status;
}

export interface SessionSummary {
  id: string;
  name: string;
  laneId: string;
  repository: string;
  branch: string;
  model: string;
  role: Session['role'];
  badge: Badge;
  pressure: Pressure;
  /** Context percent per sample, for sparklines. */
  trend: number[];
  trendText: string;
  active: string;
  openRequests: number;
  attention: boolean;
}

const isOpen = (status: string): boolean => status === 'open' || status === 'unanswered' || status === 'interrupted';

export function summarise(state: ConsoleState, session: Session): SessionSummary {
  const trend = session.samples.map(sample => sample.contextPercent);
  return {
    id: session.id, name: session.name, laneId: session.laneId, repository: repositoryName(state, session.repositoryId),
    branch: session.branch, model: session.model, role: session.role, badge: badge(displayStatus(state, session)),
    pressure: pressure(session.contextPercent), trend, trendText: sparkline(trend),
    active: age(state.liveAt, session.updatedAt),
    openRequests: state.requests.filter(request => request.sessionId === session.id && isOpen(request.status) && request.origin !== 'unproven').length,
    attention: state.needsYou.some(item => item.sessionId === session.id),
  };
}
