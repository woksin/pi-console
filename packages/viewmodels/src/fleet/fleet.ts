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

/** Shared Fleet column order; clients may omit trend first when space is limited. */
export const fleetColumns = [
  { id: 'name', label: 'Name' }, { id: 'status', label: 'Status' }, { id: 'context', label: 'Ctx' },
  { id: 'trend', label: 'Trend' }, { id: 'cost', label: 'Cost' }, { id: 'age', label: 'Age' },
] as const;

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

/** A session placed in the Fleet order; everything time-dependent is formatted later by {@link fleetRowAt}. */
export interface SessionEntry { kind: 'session'; id: string; depth: number; session: Session }
export type FleetEntry = GroupRow | SessionEntry;
/** Clock-free Fleet layout: stable order, group counts and selection keys. Rebuild only when sessions, query or collapsed groups change. */
export interface FleetStructure { entries: readonly FleetEntry[]; keys: readonly string[]; sessionCount: number; matched: number; query: string }

/** The selection key of a row: sessions by id, groups prefixed so they cannot collide with a session id. */
export const fleetEntryKey = (entry: FleetEntry): string => (entry.kind === 'group' ? `group:${entry.id}` : entry.id);

function sessionRow(session: Session, depth: number, now: number): SessionRow {
  const series = session.samples.map(sample => sample.contextPercent);
  return {
    kind: 'session', id: session.id, name: session.name, lane: session.laneId, role: session.role, depth,
    status: statusCell(session.status), contextPercent: session.contextPercent, pressure: pressure(session.contextPercent),
    spark: sparkline(series.slice(-12), 100), age: age(session.updatedAt, now),
    cost: money(session.samples.reduce((sum, sample) => sum + sample.costUsd, 0)), model: session.model, branch: session.branch, selectable: true,
  };
}

/** Formats one structural row for `now`; sessions pay for age, sparkline and cost only here. */
export const fleetRowAt = (entry: FleetEntry, now: number): FleetRow => (entry.kind === 'group' ? entry : sessionRow(entry.session, entry.depth, now));

export function fleetStructure(input: Omit<FleetInput, 'now'>): FleetStructure {
  const query = input.query?.trim() ?? '';
  const visible = query ? input.sessions.filter(session => fuzzy(query, text(session)) !== undefined) : input.sessions;
  const groups = Map.groupBy(ordered(visible), entry => entry.session.repositoryId);
  const entries: FleetEntry[] = [];
  for (const [repository, members] of groups) {
    const collapsed = input.collapsed?.has(repository) ?? false;
    entries.push({ kind: 'group', id: repository, label: repository, sessions: members.length, collapsed, attention: members.filter(entry => attentionStatuses.has(entry.session.status)).length });
    if (!collapsed) entries.push(...members.map((entry): SessionEntry => ({ kind: 'session', id: entry.session.id, depth: entry.depth, session: entry.session })));
  }
  return { entries, keys: entries.map(fleetEntryKey), sessionCount: input.sessions.length, matched: visible.length, query };
}

/** Compatibility wrapper: the whole model formatted for `input.now`. Prefer {@link fleetStructure} plus {@link fleetRowAt} for large lists. */
export function fleetViewModel(input: FleetInput): FleetViewModel {
  const structure = fleetStructure(input);
  return { rows: structure.entries.map(entry => fleetRowAt(entry, input.now)), sessionCount: structure.sessionCount, matched: structure.matched, query: structure.query };
}
