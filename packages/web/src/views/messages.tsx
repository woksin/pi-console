import { messagesViewModel, type MessageRow } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { useActions } from '../app/commands.ts';
import { hrefFor, sessionHref } from '../app/routes.ts';
import { EmptyState } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { GraphView } from './graph.tsx';

type Mode = 'list' | 'graph';

export function MessagesView({ state, now, mode }: ViewProps & { mode: Mode }) {
  const view = useMemo(() => messagesViewModel({ messages: state.messages, sessions: state.sessions, now }), [state.messages, state.sessions, now]);
  const go = (next: Mode): void => { navigate(hrefFor('messages', null, next === 'graph' ? { view: 'graph' } : {})); };
  useActions(action => { if (action !== 'view.toggle') return false; go(mode === 'graph' ? 'list' : 'graph'); return true; });
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { enabled: mode === 'list', onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.fromSessionId)); } });
  return (
    <div className="page">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Messages view"><button type="button" aria-pressed={mode === 'list'} onClick={() => { go('list'); }}>List</button><button type="button" aria-pressed={mode === 'graph'} onClick={() => { go('graph'); }}>Graph <kbd className="kbd">v</kbd></button></div>
        <span className="muted">{view.rows.length} messages</span>
      </div>
      {mode === 'graph' ? <GraphView state={state} /> : view.rows.length === 0
        ? <EmptyState title="No messages yet" mark="⌬">Messages sent between agents appear here, with whether they were delivered and read.</EmptyState>
        : <ol className="stack" aria-label="Messages">{view.rows.map(row => <MessageCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>}
    </div>
  );
}

function MessageCard({ row, selected, onSelect }: { row: MessageRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card msg${selected ? ' selected' : ''}`} onClick={onSelect} data-message={row.id}>
      <div className="card-head"><a href={sessionHref(row.fromSessionId)}>{row.from}</a><span className="faint" aria-hidden="true">→</span><a href={sessionHref(row.toSessionId)}>{row.to}</a><span className="grow" /><span className="chip" title={row.delivery}><span aria-hidden="true">{row.deliveryGlyph}</span> {row.delivery}</span><span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
    </li>
  );
}
