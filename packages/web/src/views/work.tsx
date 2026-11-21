import { workViewModel } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SkeletonRows, StatusBadge } from '../ui/primitives.tsx';
import { EmptyFor } from '../ui/empty.tsx';
import { LoadOlder } from './load-older.tsx';

export function WorkView({ state, now }: ViewProps) {
  const view = useMemo(() => workViewModel({ jobs: state.jobs, sessions: state.sessions, now }), [state.jobs, state.sessions, now]);
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="work" columns={6} /></div>;
  return (
    <div className="page">
      <div className="toolbar"><span className="muted">{view.running} running · {view.failed} failed</span></div>
      {view.rows.length === 0 ? <EmptyFor view="work" /> : (
        <table className="grid" aria-label="Work">
          <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Session</th><th>Exit</th><th className="num">Started</th></tr></thead>
          <tbody>{view.rows.map(row => (
            <tr key={row.id} className={`row${nav.selected === row.id ? ' selected' : ''}`} onClick={() => { nav.select(row.id); }}>
              <td className="truncate">{row.name}</td><td className="muted">{row.kind}</td><td><StatusBadge cell={row.status} /></td>
              <td><a href={sessionHref(row.sessionId)}>{row.session}</a></td><td className="mono muted">{row.exit}</td><td className="num tnum muted">{row.age} ago</td>
            </tr>))}</tbody>
        </table>)}
      <LoadOlder state={state} collection="jobs" shown={view.rows.length} noun="jobs" />
    </div>
  );
}
