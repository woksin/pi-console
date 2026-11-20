import type { Session } from '@pi-console/contract';
import { age, fuzzy, money, pressure, sparkline, type Pressure } from '../format/format.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

export interface FleetInput {
  sessions: readonly Session[]; now: number; query?: string; collapsed?: ReadonlySet<string>;
}
export interface GroupRow { kind: 'group'; id: string; label: string; sessions: number; attention: number; collapsed: boolean }
export interface SessionRow {
  kind: 'session'; id: string; name: string; lane: string; role: Session['role']; depth: number; status: StatusCell;
  contextPercent: number; pressure: Pressure; spark: string; age: string; cost: string; model: string; branch: string; selectable: true;
}
export type FleetRow = GroupRow | SessionRow;
export interface FleetViewModel { rows: FleetRow[]; sessionCount: number; matched: number; query: string }

const attentionStatuses = new Set(['needs-you', 'blocked', 'failed']);
const text = (session: Session) => `${session.name} ${session.laneId} ${session.branch} ${session.status} ${session.role}`;

/** Parents before their subagents, so a lane's workers sit directly beneath it. */
function ordered(sessions: readonly Session[]): { session: Session; depth: number }[] {
  const children = Map.groupBy(sessions.filter(session => session.parentSessionId), session => session.parentSessionId ?? '');
  const ids = new Set(sessions.map(session => session.id));
  const walk = (session: Session, depth: number): { session: Session; depth: number }[] =>
    [{ session, depth }, ...(children.get(session.id) ?? []).flatMap(child => walk(child, depth + 1))];
  const roots = sessions.filter(session => !session.parentSessionId || !ids.has(session.parentSessionId));
  return roots.flatMap(root => walk(root, 0));
}

function sessionRow(session: Session, depth: number, now: number): SessionRow {
  const series = session.samples.map(sample => sample.contextPercent);
  return {
    kind: 'session', id: session.id, name: session.name, lane: session.laneId, role: session.role, depth,
    status: statusCell(session.status), contextPercent: session.contextPercent, pressure: pressure(session.contextPercent),
    spark: sparkline(series.slice(-12), 100), age: age(session.updatedAt, now),
    cost: money(session.samples.reduce((sum, sample) => sum + sample.costUsd, 0)), model: session.model, branch: session.branch, selectable: true,
  };
}

export function fleetViewModel(input: FleetInput): FleetViewModel {
  const query = input.query?.trim() ?? '';
  const visible = query ? input.sessions.filter(session => fuzzy(query, text(session)) !== undefined) : input.sessions;
  const groups = Map.groupBy(ordered(visible), entry => entry.session.repositoryId);
  const rows: FleetRow[] = [];
  for (const [repository, entries] of groups) {
    const collapsed = input.collapsed?.has(repository) ?? false;
    rows.push({ kind: 'group', id: repository, label: repository, sessions: entries.length, collapsed, attention: entries.filter(entry => attentionStatuses.has(entry.session.status)).length });
    if (!collapsed) rows.push(...entries.map(entry => sessionRow(entry.session, entry.depth, input.now)));
  }
  return { rows, sessionCount: input.sessions.length, matched: visible.length, query };
}
