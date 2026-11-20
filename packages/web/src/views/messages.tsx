import { buildMessageList } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import { navigate, useConsole, useSelection } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { useViewFocus } from '../app/focus.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, Panel, SearchBox, Tabs } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { GraphView } from './graph.tsx';

type Mode = 'graph' | 'list';

function Item({ row, selected, onSelect }: { row: ReturnType<typeof buildMessageList>['rows'][number]; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`item${selected ? ' selected' : ''}`} aria-current={selected} onClick={onSelect}>
      <div className="item-top"><span className={`delivery tone-${row.delivery.color}`} title={row.delivery.label}>{row.delivery.glyph}</span><span className="truncate grow">{row.from} → {row.to}</span><time className="muted tnum">{row.age}</time></div>
      <p className="item-text">{row.text}</p>
    </li>
  );
}

function MessageList() {
  const state = useConsole();
  const [search, setSearch] = useState('');
  const box = useRef<HTMLInputElement | null>(null);
  const ids = useMemo(() => buildMessageList(state, { search }).rows.map(row => row.id), [state, search]);
  const [chosen, setChosen, move, jump] = useSelection(ids);
  const model = useMemo(() => buildMessageList(state, { search, selectedId: chosen }), [state, search, chosen]);
  useViewFocus(box);
  useCommands(command => {
    if (command.type === 'move') { move(command.delta); return true; }
    if (command.type === 'top' || command.type === 'bottom') { jump(command.type); return true; }
    if (command.type === 'open' && model.selected) { navigate(sessionHref(model.selected.toId)); return true; }
    return false;
  });
  if (model.empty) return <EmptyState title="No AI-to-AI messages yet." mark="◌">Messages sent between sessions appear here with their delivery state.</EmptyState>;
  const detail = model.selected;
  return (
    <div className="split-page">
      <header className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search messages (status:read …)" inputRef={box} /><span className="muted grow end tnum">{model.rows.length} of {model.total}</span></header>
      <div className="split">
        <ul className="list" aria-label="Messages">{model.rows.map(row => <Item key={row.id} row={row} selected={row.id === detail?.id} onSelect={() => { setChosen(row.id); }} />)}</ul>
        <section className="detail">{detail && <Panel title={`${detail.from} → ${detail.to}`} aside={detail.delivery.label}><p className="verbatim">{detail.verbatim}</p><p className="muted small">{detail.at}</p></Panel>}</section>
      </div>
    </div>
  );
}

export function MessagesView() {
  const [mode, setMode] = useState<Mode>('graph');
  useCommands(command => { if (command.type === 'nextFilter' || command.type === 'prevFilter') { setMode(value => value === 'graph' ? 'list' : 'graph'); return true; } return false; });
  return (
    <div className="page messages">
      <header className="toolbar"><Tabs tabs={[{ id: 'graph', label: 'Graph' }, { id: 'list', label: 'List' }] as const} value={mode} onChange={setMode} label="Messages view" /></header>
      {mode === 'graph' ? <GraphView /> : <MessageList />}
    </div>
  );
}
