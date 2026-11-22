import { filterQuestionRows, questionsViewModel, type QuestionRow } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useSearchFocus } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SearchBox, SkeletonRows, StatusBadge } from '../ui/primitives.tsx';
import { EmptyList } from '../ui/empty.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { LoadOlder } from './load-older.tsx';

export function QuestionsView({ state, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const model = useMemo(() => questionsViewModel({ questions: state.questions, sessions: state.sessions, now }), [state.questions, state.sessions, now]);
  const view = { ...model, rows: filterQuestionRows(model.rows, query) };
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  if (!state.snapshotLoaded) return <div className="page questions"><SkeletonRows label="questions" /></div>;
  return (
    <div className="page questions">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter questions…" inputRef={search} /><span className="muted">{view.open} open · {view.blocking} blocking</span><span className="note">Read-only in this version: answer in the session itself.</span></div>
      {view.rows.length === 0 ? <EmptyList view="questions" none={model.rows.length === 0} noun="questions" /> : (
        <ol className="stack" aria-label="Questions">{view.rows.map(row => <QuestionCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>)}
      <LoadOlder state={state} collection="questions" shown={model.rows.length} noun="questions" />
    </div>
  );
}

function QuestionCard({ row, selected, onSelect }: { row: QuestionRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card question${selected ? ' selected' : ''}${row.blocking ? ' blocking' : ''}`} onClick={onSelect} data-question={row.id}>
      <div className="card-head"><StatusBadge cell={row.status} /><span className="chip">{row.kind}</span>{row.blocking && <span className="chip warn-chip">blocking</span>}{row.urgent && <span className="urgent-mark" role="img" aria-label="Urgent" title="Urgent">‼</span>}<a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" /><span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
      {row.options.length > 0 && <ul className="question-options" aria-label="Options (read-only)">{row.options.map((option, index) => <li key={option}><span className="muted">{String.fromCharCode(65 + index)} · </span>{option}</li>)}</ul>}
    </li>
  );
}
