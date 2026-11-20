import { requestListViewModel, type RequestRow } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, StatusBadge, Tabs } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

const filters = ['all', 'open', 'unanswered', 'answered', 'interrupted'] as const;
type Filter = (typeof filters)[number];

export function RequestsView({ state, now }: ViewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const view = useMemo(() => requestListViewModel({ requests: state.requests, sessions: state.sessions, now, filter }), [state.requests, state.sessions, now, filter]);
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  return (
    <div className="page">
      <div className="toolbar"><Tabs label="Request status" value={filter} onChange={setFilter} tabs={filters.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))} /><span className="muted">{view.open} open or unanswered</span></div>
      {view.rows.length === 0 ? <EmptyState title="No requests here" mark="⇄">Requests the daemon observes appear with their answers, labelled by how sure it is who asked.</EmptyState> : (
        <ol className="stack" aria-label="Requests">{view.rows.map(row => <RequestCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>)}
    </div>
  );
}

function RequestCard({ row, selected, onSelect }: { row: RequestRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card tone-${row.status.color}${selected ? ' selected' : ''}`} onClick={onSelect} data-request={row.id}>
      <div className="card-head"><StatusBadge cell={row.status} /><span className="chip" title={row.originEvidence}>{row.originLabel}</span><a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" /><span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
      {row.answer && <blockquote className="answer"><span className="faint small">Answer · {row.answer.age} ago</span><p>{row.answer.text}</p></blockquote>}
      {!row.answer && row.partial && <blockquote className="answer partial"><span className="faint small">Partial answer · {row.partial.age} ago</span><p>{row.partial.text}</p></blockquote>}
    </li>
  );
}
