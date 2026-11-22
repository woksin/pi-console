import { filterWorkRows, workViewModel, type WorkRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useSearchFocus } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SearchBox, SkeletonRows, StatusBadge } from '../ui/primitives.tsx';
import { EmptyList } from '../ui/empty.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { LoadOlder } from './load-older.tsx';

export function WorkView({ state, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const model = useMemo(() => workViewModel({ jobs: state.jobs, sessions: state.sessions, now }), [state.jobs, state.sessions, now]);
  const view = { ...model, rows: filterWorkRows(model.rows, query) };
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="work" columns={6} /></div>;
  return (
    <div className="page">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter work…" inputRef={search} /><span className="muted">{view.running} running · {view.failed} failed</span></div>
      {view.rows.length === 0 ? <EmptyList view="work" none={model.rows.length === 0} noun="jobs" /> : (
        <table className="grid" aria-label="Work">
          <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Session</th><th>Exit</th><th className="num">Started</th></tr></thead>
          <tbody>{view.rows.map(row => (
            <WorkLine key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />))}</tbody>
        </table>)}
      <LoadOlder state={state} collection="jobs" shown={model.rows.length} noun="jobs" />
    </div>
  );
}

function WorkLine({ row, selected, onSelect }: { row: WorkRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLTableRowElement>(selected);
  return (
    <tr ref={ref} className={`row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <td className="truncate">{row.name}</td><td className="muted">{row.kind}</td><td><StatusBadge cell={row.status} /></td>
      <td><a href={sessionHref(row.sessionId)}>{row.session}</a></td><td className="mono muted">{row.exit}</td><td className="num tnum muted">{row.age} ago</td>
    </tr>
  );
}
