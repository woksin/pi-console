import { buildQuestions, type QuestionFilter } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import { copyText, navigate, useConsole, useSelection } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { useViewFocus } from '../app/focus.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, Kbd, Panel, SearchBox, StatusBadge, Tabs } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

function Item({ row, selected, onSelect }: { row: ReturnType<typeof buildQuestions>['rows'][number]; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`item tone-${row.badge.color}${selected ? ' selected' : ''}`} aria-current={selected} onClick={onSelect}>
      <div className="item-top"><StatusBadge badge={row.badge} /><span className="pill">{row.kind}</span>{row.urgency === 'high' && <span className="pill amber">urgent</span>}{row.blocking && <span className="pill">blocking</span>}<span className="grow" /><time className="muted tnum">{row.age}</time></div>
      <p className="item-text">{row.text}</p><span className="muted small">{row.session}</span>
    </li>
  );
}

export function QuestionsView({ selectedId }: { selectedId: string | null }) {
  const state = useConsole();
  const [filter, setFilter] = useState<QuestionFilter>('open');
  const [search, setSearch] = useState('');
  const box = useRef<HTMLInputElement | null>(null);
  const ids = useMemo(() => buildQuestions(state, { filter, search }).rows.map(row => row.id), [state, filter, search]);
  const [chosen, setChosen, move, jump] = useSelection(ids, selectedId);
  const model = useMemo(() => buildQuestions(state, { filter, search, selectedId: chosen }), [state, filter, search, chosen]);
  useViewFocus(box);
  useCommands(command => {
    if (command.type === 'move') { move(command.delta); return true; }
    if (command.type === 'top' || command.type === 'bottom') { jump(command.type); return true; }
    if (command.type === 'copyId' && chosen) { void copyText(chosen); return true; }
    if (command.type === 'open' && model.selected) { navigate(sessionHref(model.selected.sessionId)); return true; }
    return false;
  });
  const detail = model.selected;
  return (
    <div className="page split-page">
      <header className="toolbar"><Tabs tabs={model.tabs} value={filter} onChange={setFilter} label="Question filter" /><SearchBox value={search} onChange={setSearch} placeholder="Search questions" inputRef={box} /><span className="muted grow end tnum">{model.heading}</span></header>
      {model.empty ? <EmptyState title={model.emptyText} mark="◌" /> : (
        <div className="split">
          <ul className="list" aria-label="Questions">{model.rows.map(row => <Item key={row.id} row={row} selected={row.id === detail?.id} onSelect={() => { setChosen(row.id); }} />)}</ul>
          <section className="detail" aria-label="Question detail">
            {detail && (
              <>
                <header className="detail-head"><StatusBadge badge={detail.badge} /><h2>{detail.kind} · {detail.urgency}</h2><span className="muted">{detail.session}</span></header>
                <Panel title="Question"><p className="verbatim">{detail.verbatim}</p></Panel>
                <Panel title="Options" aside="read-only">
                  <div className="options">{detail.options.map(option => <button key={option.key} type="button" className="chip" disabled title={detail.readOnlyNote}><Kbd>{option.key}</Kbd>{option.text}</button>)}</div>
                  {detail.options.length === 0 && <p className="muted">Free-form question.</p>}
                  <p className="note">{detail.readOnlyNote}</p>
                </Panel>
                <a className="btn primary" href={sessionHref(detail.sessionId)}>Open session</a>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
