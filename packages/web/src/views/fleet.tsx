import { fleetViewModel, type FleetRow, type SessionRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useSearchFocus } from '../app/hooks.ts';
import { useActions } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { LoadOlder } from './load-older.tsx';
import { EmptyFor, FirstRun } from '../ui/empty.tsx';
import { EmptyState, SkeletonRows, PressureBar, SearchBox, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useChangeFlash, useScrollIntoView } from '../ui/hooks.ts';

const rowKey = (row: FleetRow): string => (row.kind === 'group' ? `group:${row.id}` : row.id);

const groupOf = (key: string | null): string | null => (key?.startsWith('group:') ? key.slice('group:'.length) : null);

const toggled = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

function FleetEmpty({ none, connected }: { none: boolean; connected: boolean }) {
  if (none) return <><EmptyFor view="fleet" /><FirstRun connected={connected} sessions={0} /></>;
  return <EmptyState title="No sessions match">Clear the filter to see the whole fleet.</EmptyState>;
}

export function FleetView({ state, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const view = useMemo(() => fleetViewModel({ sessions: state.sessions, now, query, collapsed }), [state.sessions, now, query, collapsed]);
  const ids = view.rows.map(rowKey);
  const firstSession = view.rows.find(row => row.kind !== 'group')?.id ?? null;
  const toggle = (group: string): void => { setCollapsed(current => toggled(current, group)); };
  const nav = useListNav(ids, { fallback: firstSession, onOpen: id => { const group = groupOf(id); if (group === null) navigate(sessionHref(id)); else toggle(group); } });
  const selectedGroup = groupOf(nav.selected);
  useActions(action => {
    if (action !== 'group.toggle' || selectedGroup === null) return false;
    toggle(selectedGroup);
    return true;
  });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="sessions" columns={7} /></div>;
  return (
    <div className="page">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter sessions, lanes, branches…" inputRef={search} /><span className="muted">{view.matched} of {view.sessionCount} sessions</span></div>
      {view.rows.length === 0 ? <FleetEmpty none={view.sessionCount === 0} connected={state.connection === 'live'} /> : (
        <table className="grid" aria-label="Fleet">
          <thead><tr><th>Session</th><th>Status</th><th>Context</th><th>Trend</th><th>Model</th><th className="num">Cost</th><th className="num">Age</th></tr></thead>
          <tbody>{view.rows.map(row => row.kind === 'group'
            ? <GroupRow key={rowKey(row)} row={row} selected={nav.selected === rowKey(row)} onToggle={() => { nav.select(rowKey(row)); toggle(row.id); }} />
            : <SessionLine key={row.id} row={row} selected={nav.selected === row.id} />)}</tbody>
        </table>)}
      <LoadOlder state={state} collection="sessions" shown={state.sessions.length} noun="sessions" />
    </div>
  );
}

function GroupRow({ row, selected, onToggle }: { row: Extract<FleetRow, { kind: 'group' }>; selected: boolean; onToggle: () => void }) {
  return (
    <tr className={`group-row${selected ? ' selected' : ''}`}><th colSpan={7} scope="colgroup">
      <button type="button" className="group-toggle" aria-expanded={!row.collapsed} onClick={onToggle}>
        <span aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span> {row.label} <span className="pill">{row.sessions}</span>{row.attention > 0 && <span className="pill amber">{row.attention} need attention</span>}
      </button>
    </th></tr>
  );
}

function SessionLine({ row, selected }: { row: SessionRow; selected: boolean }) {
  const ref = useScrollIntoView<HTMLTableRowElement>(selected);
  const flash = useChangeFlash(row.status.status);
  const attention = row.status.status === 'needs-you' || row.status.status === 'blocked' || row.status.status === 'failed';
  return (
    <tr ref={ref} className={`row${selected ? ' selected' : ''}${flash ? ' flash' : ''}${attention ? ' attention' : ''}`} data-session={row.id} aria-selected={selected}>
      <td><a href={sessionHref(row.id)} style={{ paddingLeft: `${String(row.depth * 18)}px` }}>{row.depth > 0 && <span className="faint" aria-hidden="true">↳ </span>}{row.name}</a><div className="faint small" style={{ paddingLeft: `${String(row.depth * 18)}px` }}>{row.lane} · {row.branch}</div></td>
      <td><StatusBadge cell={row.status} /></td>
      <td><PressureBar percent={row.contextPercent} pressure={row.pressure} /></td>
      <td><Sparkline values={sparkValues(row.spark)} width={72} height={20} tone={row.pressure === 'hot' ? 'red' : row.pressure === 'warm' ? 'amber' : 'cyan'} label={`${row.name} context trend`} /></td>
      <td className="muted truncate">{row.model}</td><td className="num tnum">{row.cost}</td><td className="num tnum muted">{row.age}</td>
    </tr>
  );
}

/** The view model carries the trend as block glyphs (shared with the TUI); read their heights back as numbers for the SVG line. */
const sparkValues = (glyphs: string): number[] => Array.from(glyphs, glyph => '▁▂▃▄▅▆▇█'.indexOf(glyph) + 1);
