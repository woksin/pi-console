import { filterWorkRows, workRowAt, workStructure, type WorkRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useSearchFocus } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SearchBox, SkeletonRows, StatusBadge } from '../ui/primitives.tsx';
import { EmptyList } from '../ui/empty.tsx';
import { SpacerRow, useVirtualTable, type VirtualRowAttributes } from '../ui/virtual-table.tsx';
import { useVirtualSelection } from '../ui/virtual-selection.ts';
import { LoadOlder } from './load-older.tsx';

const fallbackHeights = [41];
const columnCount = 6;

export function WorkView({ state, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const structure = useMemo(() => workStructure({ jobs: state.jobs, sessions: state.sessions }), [state.jobs, state.sessions]);
  const entries = useMemo(() => filterWorkRows(structure.entries, query), [structure, query]);
  const ids = useMemo(() => entries.map(entry => entry.id), [entries]);
  const kinds = useMemo(() => new Uint8Array(entries.length), [entries]);
  const table = useVirtualTable({ keys: ids, kinds, fallbackHeights });
  const { nav, indexOfKey } = useVirtualSelection(ids, table, {
    trigger: query,
    onOpen: id => { const index = indexOfKey.get(id); if (index !== undefined) navigate(sessionHref(entries[index].sessionId)); },
  });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="work" columns={6} /></div>;
  return (
    <div className="page">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter work…" inputRef={search} /><span className="muted">{structure.running} running · {structure.failed} failed</span></div>
      {entries.length === 0 ? <EmptyList view="work" none={structure.entries.length === 0} noun="jobs" /> : (
        <table className="grid" aria-label="Work" aria-rowcount={table.count + 1}>
          <thead><tr aria-rowindex={1}><th>Name</th><th>Kind</th><th>Status</th><th>Session</th><th>Exit</th><th className="num">Started</th></tr></thead>
          <tbody {...table.bodyProps}>{table.segments.map((segment, position) => {
            if (segment.kind === 'spacer') return <SpacerRow key={`spacer-${String(position)}`} height={segment.height} columns={columnCount} />;
            const entry = entries[segment.index];
            return <WorkLine key={entry.id} row={workRowAt(entry, now)} attributes={table.rowAttributes(segment.index)} selected={nav.selected === entry.id} onSelect={() => { nav.select(entry.id); }} />;
          })}</tbody>
        </table>)}
      <LoadOlder state={state} collection="jobs" shown={structure.entries.length} noun="jobs" />
    </div>
  );
}

function WorkLine({ row, attributes, selected, onSelect }: { row: WorkRow; attributes: VirtualRowAttributes; selected: boolean; onSelect: () => void }) {
  return (
    <tr {...attributes} className={`row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <td className="truncate">{row.name}</td><td className="muted">{row.kind}</td><td><StatusBadge cell={row.status} /></td>
      <td><a href={sessionHref(row.sessionId)}>{row.session.title}</a></td><td className="mono muted">{row.exit}</td><td className="num tnum muted">{row.age} ago</td>
    </tr>
  );
}
