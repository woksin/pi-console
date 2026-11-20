import { buildRequests, type RequestFilter } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import { copyText, navigate, useConsole, useSelection } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { useViewFocus } from '../app/focus.ts';
import { hrefFor, sessionHref } from '../app/routes.ts';
import { EmptyState, Panel, SearchBox, StatusBadge, Tabs } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

function Item({ row, selected, onSelect }: { row: ReturnType<typeof buildRequests>['rows'][number]; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`item tone-${row.badge.color}${selected ? ' selected' : ''}`} aria-current={selected} onClick={onSelect}>
      <div className="item-top"><StatusBadge badge={row.badge} /><span className="muted truncate grow">{row.session}</span><time className="muted tnum">{row.age}</time></div>
      <p className="item-text">{row.text}</p>
      <span className="muted small">{row.origin}</span>
    </li>
  );
}

export function RequestsView({ selectedId }: { selectedId: string | null }) {
  const state = useConsole();
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [search, setSearch] = useState('');
  const box = useRef<HTMLInputElement | null>(null);
  const [chosen, setChosen, move, jump] = useSelection(useMemo(() => buildRequests(state, { filter, search }).rows.map(row => row.id), [state, filter, search]), selectedId);
  const model = useMemo(() => buildRequests(state, { filter, search, selectedId: chosen }), [state, filter, search, chosen]);
  useViewFocus(box);
  useCommands(command => {
    if (command.type === 'move') { move(command.delta); return true; }
    if (command.type === 'top' || command.type === 'bottom') { jump(command.type); return true; }
    if (command.type === 'copyId' && chosen) { void copyText(chosen); return true; }
    if (command.type === 'open' && model.selected) { navigate(sessionHref(model.selected.sessionId, model.selected.entryId)); return true; }
    return false;
  });
  if (model.empty) return <div className="page"><EmptyState title="No requests recorded yet." mark="◇">This view tracks the requests given to each session and their answers, within the backfill window.</EmptyState></div>;
  const detail = model.selected;
  return (
    <div className="page split-page">
      <header className="toolbar">
        <Tabs tabs={model.tabs} value={filter} onChange={setFilter} label="Request filter" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search requests" inputRef={box} />
      </header>
      <div className="split">
        <ul className="list" aria-label="Requests">{model.rows.map(row => <Item key={row.id} row={row} selected={row.id === detail?.id} onSelect={() => { setChosen(row.id); }} />)}</ul>
        <section className="detail" aria-label="Request detail">
          {detail ? (
            <>
              <header className="detail-head"><StatusBadge badge={detail.badge} /><h2>{detail.id}</h2><span className="muted">{detail.session}</span></header>
              <Panel title="Request" aside={detail.origin}><p className="verbatim">{detail.verbatim}</p>
                {detail.uncertain && <p className="note warn">Unproven origin: nothing proves a human wrote this, so it never raises a badge.</p>}
                <p className="muted small">Evidence: {detail.originEvidence}</p></Panel>
              {detail.interimAnswers.length > 0 && <Panel title="Interim answers">{detail.interimAnswers.map(item => <p key={item.at + item.text} className="verbatim muted"><time className="tnum">{item.at}</time> {item.text}</p>)}</Panel>}
              <Panel title={detail.answer ? 'Final answer' : 'No final answer yet'} aside={detail.answer?.at}>
                {detail.answer ? <p className="verbatim">{detail.answer.text}</p> : <p className="muted">{detail.statusText}</p>}
              </Panel>
              {detail.boundary && <Panel title="Reset boundary"><p>{detail.boundary.kind} at {detail.boundary.at}: {detail.boundary.carried} carried, {detail.boundary.interrupted} interrupted.</p></Panel>}
              <a className="btn primary" href={sessionHref(detail.sessionId, detail.entryId)}>{detail.entryId ? 'Open at the request' : 'Open session'}</a>
              <a className="btn" href={hrefFor('requests', detail.id)}>Link</a>
            </>
          ) : <EmptyState title="No request selected." mark="○" />}
        </section>
      </div>
    </div>
  );
}
