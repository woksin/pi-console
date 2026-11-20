import { questionsViewModel, type QuestionRow } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, StatusBadge } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

export function QuestionsView({ state, now }: ViewProps) {
  const view = useMemo(() => questionsViewModel({ questions: state.questions, sessions: state.sessions, now }), [state.questions, state.sessions, now]);
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  return (
    <div className="page">
      <div className="toolbar"><span className="muted">{view.open} open · {view.blocking} blocking</span><span className="note">Read-only in this version: answer in the session itself.</span></div>
      {view.rows.length === 0 ? <EmptyState title="No questions" mark="?">Agents raise questions and decisions here when they need you.</EmptyState> : (
        <ol className="stack" aria-label="Questions">{view.rows.map(row => <QuestionCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>)}
    </div>
  );
}

function QuestionCard({ row, selected, onSelect }: { row: QuestionRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card tone-${row.status.color}${selected ? ' selected' : ''}${row.blocking ? ' blocking' : ''}`} onClick={onSelect} data-question={row.id}>
      <div className="card-head"><StatusBadge cell={row.status} /><span className="chip">{row.kind}</span>{row.blocking && <span className="chip warn-chip">blocking</span>}{row.urgent && <span className="chip warn-chip">urgent</span>}<a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" /><span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
      {row.options.length > 0 && <ul className="options" aria-label="Options">{row.options.map(option => <li key={option} className="chip">{option}</li>)}</ul>}
    </li>
  );
}
