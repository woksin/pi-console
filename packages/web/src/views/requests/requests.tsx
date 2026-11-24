import { cycleRequestFilter, describeRequestFilter, requestDetail, requestFilterAction, requestsViewModel, requestStateFilters } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../../app/view.tsx';
import { useActions } from '../../app/commands.ts';
import { navigate, useListNav, useSearchFocus } from '../../app/hooks.ts';
import { sessionHref } from '../../app/routes.ts';
import { EmptyState, SkeletonRows, SearchBox } from '../../ui/primitives.tsx';
import { EmptyFor } from '../../ui/empty.tsx';
import { LoadOlder } from '../load-older.tsx';
import { activeFilterChips, defaultRequestFilter } from './request-summary.ts';
import { RequestCard } from './request-card.tsx';
import { RequestDetailPane } from './request-detail.tsx';

const stateOptions = requestStateFilters.map(id => ({ id, label: id === 'possibly-unseen' ? 'Possibly unseen' : id[0].toUpperCase() + id.slice(1) }));

/** Requests and answers: the list with filters, and the detail of the selected row. Read-only; text is rendered as text. */
function RequestSummary({ view }: { view: ReturnType<typeof requestsViewModel> }) {
  return <div className="toolbar" data-testid="request-summary" aria-label={describeRequestFilter(view)}>
    {activeFilterChips(view).map(chip => <span key={chip} className="chip">{chip}</span>)}
    <span className="chip">{view.rows.length} shown</span><span className="chip">{view.open} open or unanswered</span>
    <span className="chip">{view.uncertain} uncertain</span><span className="chip">{view.possiblyUnseen} possibly unseen</span>
  </div>;
}

export function RequestsView({ state, now }: ViewProps) {
  const [filter, setFilter] = useState(defaultRequestFilter);
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const view = useMemo(() => requestsViewModel({ requests: state.requests, sessions: state.sessions, now, filter }), [state.requests, state.sessions, now, filter]);
  useActions(action => {
    const cycle = requestFilterAction(action);
    if (!cycle) return false;
    setFilter(cycleRequestFilter(view.filter, cycle.axis, view.sessions.map(item => item.id), cycle.step));
    return true;
  });
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const jump = (id: string): void => {
    const row = rows.get(id);
    if (row) navigate(sessionHref(row.sessionId, row.transcript?.entryId));
  };
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: jump });
  const selected = state.requests.find(request => request.id === nav.selected);
  const detail = useMemo(() => (selected ? requestDetail({ request: selected, sessions: state.sessions, now }) : null), [selected, state.sessions, now]);
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="requests" /></div>;
  return (
    <div className="page requests">
      <div className="toolbar request-filters">
        <label className="field">State
          <select value={view.filter.state} onChange={event => { setFilter({ ...view.filter, state: event.target.value as typeof filter.state }); }}>
            {stateOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">Origin
          <select value={view.filter.origin} onChange={event => { setFilter({ ...view.filter, origin: event.target.value as typeof filter.origin }); }}>
            {['all', 'human', 'launch', 'unproven'].map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className="field">Session
          <select value={view.filter.sessionId ?? ''} onChange={event => { setFilter({ ...view.filter, sessionId: event.target.value || null }); }}>
            <option value="">all</option>
            {view.sessions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <SearchBox inputRef={search} value={filter.query} onChange={query => { setFilter({ ...view.filter, query }); }} placeholder="Filter requests" />
      </div>
      <LoadOlder state={state} collection="requests" shown={state.requests.length} noun="requests" />
      <RequestSummary view={view} />
      {view.rows.length === 0 ? (state.requests.length === 0 ? <EmptyFor view="requests" /> : <EmptyState title="No requests here" mark="⇄">No request matches this tab or filter.</EmptyState>) : (
        <div className="requests-split">
          <ol className="stack" aria-label="Requests">{view.rows.map(row => <RequestCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>
          {detail && <RequestDetailPane detail={detail} />}
        </div>)}
    </div>
  );
}
