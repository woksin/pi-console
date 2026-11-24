import { filterMessageRows, sessionLabels, messagesViewModel, type MessageRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useSearchFocus } from '../app/hooks.ts';
import { useActions } from '../app/commands.ts';
import { hrefFor, sessionHref } from '../app/routes.ts';
import { EmptyList } from '../ui/empty.tsx';
import { SearchBox, SkeletonRows } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { GraphView } from './graph.tsx';
import { LoadOlder } from './load-older.tsx';

type Mode = 'list' | 'graph';

/** Filters the raw rows with the shared match rules (as the TUI does), then labels lanes (the filter does not apply to the graph) for display; `total` is the unfiltered count. */
function useMessageRows(state: ViewProps['state'], now: number, mode: Mode, query: string): { view: { rows: MessageRow[] }; total: number } {
  const model = useMemo(() => messagesViewModel({ messages: state.messages, sessions: state.sessions, now }), [state.messages, state.sessions, now]);
  const matched = useMemo(() => filterMessageRows(model.rows, mode === 'list' ? query : ''), [model.rows, mode, query]);
  const view = useMemo(() => {
    const names = new Map(state.sessions.map(session => [session.id, sessionLabels(session).title]));
    return { rows: matched.map(row => ({ ...row, from: names.get(row.fromSessionId) ?? row.from, to: names.get(row.toSessionId) ?? row.to })) };
  }, [matched, state.sessions]);
  return { view, total: model.rows.length };
}

export function MessagesView({ state, now, mode }: ViewProps & { mode: Mode }) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const { view, total } = useMessageRows(state, now, mode, query);
  const go = (next: Mode): void => { navigate(hrefFor('messages', null, next === 'graph' ? { view: 'graph' } : {})); };
  useActions(action => { if (action !== 'view.toggle') return false; go(mode === 'graph' ? 'list' : 'graph'); return true; });
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { enabled: mode === 'list', onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.fromSessionId)); } });
  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Messages view"><button type="button" aria-pressed={mode === 'list'} onClick={() => { go('list'); }}>List</button><button type="button" aria-pressed={mode === 'graph'} onClick={() => { go('graph'); }}>Graph <kbd className="kbd">v</kbd></button></div>
        {mode === 'list' && <SearchBox value={query} onChange={setQuery} placeholder="Filter messages…" inputRef={search} />}
        <span className="muted">{view.rows.length} messages</span>
      </div>
      {mode === 'list' && <LoadOlder state={state} collection="messages" shown={total} noun="messages" />}
      {mode === 'graph' ? <GraphView state={state} /> : <MessageList loaded={state.snapshotLoaded} rows={view.rows} total={total} nav={nav} />}
    </div>
  );
}

function MessageCard({ row, selected, onSelect }: { row: MessageRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card msg${selected ? ' selected' : ''}`} onClick={onSelect} data-message={row.id} aria-current={selected ? 'true' : undefined}>
      <div className="card-head"><a href={sessionHref(row.fromSessionId)}>{row.from}</a><span className="faint" aria-hidden="true">→</span><a href={sessionHref(row.toSessionId)}>{row.to}</a><span className="grow" /><span className="chip" title={row.delivery}><span aria-hidden="true">{row.deliveryGlyph}</span> {row.delivery}</span><span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
    </li>
  );
}

function MessageList({ loaded, rows, total, nav }: { loaded: boolean; rows: MessageRow[]; total: number; nav: { selected: string | null; select: (id: string) => void } }) {
  if (!loaded) return <SkeletonRows label="messages" />;
  if (rows.length === 0) return <EmptyList view="messages" none={total === 0} noun="messages" />;
  return <ol className="stack" aria-label="Messages">{rows.map(row => <MessageCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>;
}
