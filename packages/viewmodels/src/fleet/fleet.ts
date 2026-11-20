import type { Session } from '@pi-console/contract';
import { matches, parseFilter } from '../common/filter.ts';
import { plural } from '../common/format.ts';
import { summarise, type SessionSummary } from '../common/sessions.ts';
import { repositoryName, type ConsoleState } from '../state/index.ts';

export type FleetGrouping = 'repository' | 'status';

export interface FleetContext { filter?: string; grouping?: FleetGrouping; collapsed?: readonly string[] }

export interface FleetRow extends SessionSummary { depth: 0 | 1; subagents: number }

export interface FleetGroup { id: string; name: string; count: number; collapsed: boolean; rows: FleetRow[] }

export interface FleetViewModel {
  grouping: FleetGrouping;
  filter: string;
  total: number;
  shown: number;
  summary: string;
  groups: FleetGroup[];
  /** Flat ids in display order, for keyboard movement. */
  order: string[];
  empty: boolean;
}

/** Saved filters stepped with `[` and `]`. */
export const fleetFilters = ['', 'status:needs-you', 'status:working', 'status:blocked,failed', 'status:waiting,idle'] as const;

function rowsFor(state: ConsoleState, sessions: readonly Session[]): FleetRow[] {
  const ids = new Set(sessions.map(session => session.id));
  const children = (id: string) => sessions.filter(session => session.parentSessionId === id);
  const top = sessions.filter(session => !session.parentSessionId || !ids.has(session.parentSessionId));
  return top.flatMap(session => [
    { ...summarise(state, session), depth: 0 as const, subagents: children(session.id).length },
    ...children(session.id).map(child => ({ ...summarise(state, child), depth: 1 as const, subagents: 0 })),
  ]);
}

function searchable(state: ConsoleState, session: Session): string {
  return `${session.name} ${session.laneId} ${repositoryName(state, session.repositoryId)} ${session.branch} ${session.model}`;
}

function groupKey(state: ConsoleState, session: Session, grouping: FleetGrouping): { id: string; name: string } {
  if (grouping === 'status') return { id: summarise(state, session).badge.status, name: summarise(state, session).badge.label };
  return { id: session.repositoryId, name: repositoryName(state, session.repositoryId) };
}

export function buildFleet(state: ConsoleState, context: FleetContext = {}): FleetViewModel {
  const grouping = context.grouping ?? 'repository';
  const filter = context.filter ?? '';
  const parsed = parseFilter(filter);
  const visible = state.sessions.filter(session => matches(parsed, searchable(state, session), { status: summarise(state, session).badge.status }));
  const keyed = new Map<string, { name: string; sessions: Session[] }>();
  for (const session of visible) {
    const { id, name } = groupKey(state, session, grouping);
    keyed.set(id, { name, sessions: [...keyed.get(id)?.sessions ?? [], session] });
  }
  const collapsed = new Set(context.collapsed ?? []);
  const groups = [...keyed.entries()].map(([id, group]): FleetGroup => {
    const rows = rowsFor(state, group.sessions);
    return { id, name: group.name, count: group.sessions.length, collapsed: collapsed.has(id), rows };
  });
  const order = groups.flatMap(group => group.collapsed ? [] : group.rows.map(row => row.id));
  return {
    grouping, filter, total: state.sessions.length, shown: visible.length, groups, order, empty: state.sessions.length === 0,
    summary: `${String(visible.length)} of ${plural(state.sessions.length, 'session')}`,
  };
}
