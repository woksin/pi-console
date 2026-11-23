import { fleetEntryKey, fleetRowAt, fleetStructure, type FleetEntry, type GroupRow as GroupModel, type SessionRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useSearchFocus } from '../app/hooks.ts';
import { useActions } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { LoadOlder } from './load-older.tsx';
import { EmptyFor, FirstRun } from '../ui/empty.tsx';
import { EmptyState, SkeletonRows, PressureBar, SearchBox, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useChangeFlash } from '../ui/hooks.ts';
import { SpacerRow, useVirtualTable, type VirtualRowAttributes, type VirtualTable } from '../ui/virtual-table.tsx';
import { useVirtualSelection } from '../ui/virtual-selection.ts';

/** Row kinds for the virtual table: session rows are two lines tall, group rows one. */
const kindOf = (entry: FleetEntry): number => (entry.kind === 'group' ? 1 : 0);
const fallbackHeights = [53, 34];
const columnCount = 7;

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
  const structure = useMemo(() => fleetStructure({ sessions: state.sessions, query, collapsed }), [state.sessions, query, collapsed]);
  const { entries, keys } = structure;
  const kinds = useMemo(() => Uint8Array.from(entries, kindOf), [entries]);
  const table = useVirtualTable({ kinds, fallbackHeights });
  const trigger = useMemo(() => ({ query, collapsed }), [query, collapsed]);
  const toggle = (group: string): void => { setCollapsed(current => toggled(current, group)); };
  const { nav } = useVirtualSelection(keys, table, {
    trigger, fallback: entries.find(entry => entry.kind === 'session')?.id ?? null,
    onOpen: id => { const group = groupOf(id); if (group === null) navigate(sessionHref(id)); else toggle(group); },
  });
  const selectedGroup = groupOf(nav.selected);
  useActions(action => {
    if (action !== 'group.toggle' || selectedGroup === null) return false;
    toggle(selectedGroup);
    return true;
  });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="sessions" columns={7} /></div>;
  return (
    <div className="page">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter sessions, lanes, branches…" inputRef={search} /><span className="muted">{structure.matched} of {structure.sessionCount} sessions</span></div>
      {entries.length === 0 ? <FleetEmpty none={structure.sessionCount === 0} connected={state.connection === 'live'} /> : <FleetTable entries={entries} table={table} selected={nav.selected} now={now} onSelect={nav.select} onToggle={toggle} />}
      <LoadOlder state={state} collection="sessions" shown={state.sessions.length} noun="sessions" />
    </div>
  );
}

interface FleetTableProps { entries: readonly FleetEntry[]; table: VirtualTable; selected: string | null; now: number; onSelect: (key: string) => void; onToggle: (group: string) => void }

/** The native Fleet table: header and mounted rows only, with spacers standing in for the rest. */
function FleetTable({ entries, table, selected, now, onSelect, onToggle }: FleetTableProps) {
  return (
    <table className="grid" aria-label="Fleet" aria-rowcount={table.count + 1}>
      <thead><tr aria-rowindex={1}><th>Session</th><th>Status</th><th>Context</th><th>Trend</th><th>Model</th><th className="num">Cost</th><th className="num">Age</th></tr></thead>
      <tbody {...table.bodyProps}>{table.segments.map((segment, position) => {
        if (segment.kind === 'spacer') return <SpacerRow key={`spacer-${String(position)}`} height={segment.height} columns={columnCount} />;
        const entry = entries[segment.index];
        const key = fleetEntryKey(entry);
        const attributes = table.rowAttributes(segment.index);
        const row = fleetRowAt(entry, now);
        return row.kind === 'group'
          ? <GroupRow key={key} row={row} attributes={attributes} selected={selected === key} onToggle={() => { onSelect(key); onToggle(row.id); }} />
          : <SessionLine key={key} row={row} attributes={attributes} selected={selected === key} />;
      })}</tbody>
    </table>
  );
}

function GroupRow({ row, attributes, selected, onToggle }: { row: GroupModel; attributes: VirtualRowAttributes; selected: boolean; onToggle: () => void }) {
  return (
    <tr {...attributes} className={`group-row${selected ? ' selected' : ''}`} aria-current={selected ? 'true' : undefined}><th colSpan={7} scope="colgroup">
      <button type="button" className="group-toggle" aria-expanded={!row.collapsed} onClick={onToggle}>
        <span aria-hidden="true">{row.collapsed ? '▸' : '▾'}</span> {row.label} <span className="pill">{row.sessions}</span>{row.attention > 0 && <span className="pill amber">{row.attention} need attention</span>}
      </button>
    </th></tr>
  );
}

function SessionLine({ row, attributes, selected }: { row: SessionRow; attributes: VirtualRowAttributes; selected: boolean }) {
  const flash = useChangeFlash(row.status.status);
  const attention = row.status.status === 'needs-you' || row.status.status === 'blocked' || row.status.status === 'failed';
  return (
    <tr {...attributes} className={`row${selected ? ' selected' : ''}${flash ? ' flash' : ''}${attention ? ' attention' : ''}`} data-session={row.id} aria-current={selected ? 'true' : undefined}>
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
