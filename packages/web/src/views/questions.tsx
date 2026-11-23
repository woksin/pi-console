import { defaultStaleDays, filterQuestionRows, questionSortLabels, questionSorts, questionsViewModel, staleDayPresets, type QuestionRow, type QuestionSort } from '@pi-console/viewmodels';
import { useMemo, useRef, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useSearchFocus } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SearchBox, SkeletonRows, StatusBadge } from '../ui/primitives.tsx';
import { EmptyList } from '../ui/empty.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { LoadOlder } from './load-older.tsx';

/** Kept for this page session across navigation; a reload starts again at the defaults. */
const preferences: { sort: QuestionSort; staleDays: number } = { sort: 'priority', staleDays: defaultStaleDays };

function Preferences({ sort, staleDays, onChange }: { sort: QuestionSort; staleDays: number; onChange: (next: { sort: QuestionSort; staleDays: number }) => void }) {
  return (
    <>
      <label className="field">Sort
        <select value={sort} onChange={event => { onChange({ sort: event.target.value as QuestionSort, staleDays }); }}>
          {questionSorts.map(id => <option key={id} value={id}>{questionSortLabels[id]}</option>)}
        </select>
      </label>
      <label className="field">Warn after
        <select value={staleDays} onChange={event => { onChange({ sort, staleDays: Number(event.target.value) }); }}>
          {staleDayPresets.map(days => <option key={days} value={days}>{days === 1 ? '1 day' : `${String(days)} days`} without activity</option>)}
        </select>
      </label>
    </>
  );
}

export function QuestionsView({ state, now }: ViewProps) {
  const [query, setQuery] = useState('');
  const [chosen, choose] = useState(preferences);
  const setPreferences = (next: typeof preferences) => { Object.assign(preferences, next); choose(next); };
  const search = useRef<HTMLInputElement>(null);
  useSearchFocus(search);
  const model = useMemo(() => questionsViewModel({ questions: state.questions, sessions: state.sessions, now, sort: chosen.sort, staleDays: chosen.staleDays }), [state.questions, state.sessions, now, chosen]);
  const view = { ...model, rows: filterQuestionRows(model.rows, query) };
  const rows = new Map(view.rows.map(row => [row.id, row]));
  const nav = useListNav(view.rows.map(row => row.id), { onOpen: id => { const row = rows.get(id); if (row) navigate(sessionHref(row.sessionId)); } });
  if (!state.snapshotLoaded) return <div className="page questions"><SkeletonRows label="questions" /></div>;
  return (
    <div className="page questions">
      <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Filter questions…" inputRef={search} /><Preferences sort={chosen.sort} staleDays={chosen.staleDays} onChange={setPreferences} /><span className="muted">{view.open} open · {view.blocking} blocking</span><span className="note">Read-only in this version: answer in the session itself.</span></div>
      {view.rows.length === 0 ? <EmptyList view="questions" none={model.rows.length === 0} noun="questions" /> : (
        <ol className="stack" aria-label="Questions">{view.rows.map(row => <QuestionCard key={row.id} row={row} selected={nav.selected === row.id} onSelect={() => { nav.select(row.id); }} />)}</ol>)}
      <LoadOlder state={state} collection="questions" shown={model.rows.length} noun="questions" />
    </div>
  );
}

function QuestionCard({ row, selected, onSelect }: { row: QuestionRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card question${selected ? ' selected' : ''}${row.blocking ? ' blocking' : ''}`} onClick={onSelect} data-question={row.id} aria-current={selected ? 'true' : undefined}>
      <div className="card-head"><StatusBadge cell={row.status} /><span className="chip">{row.kind}</span>{row.blocking && <span className="chip warn-chip">blocking</span>}{row.urgent && <span className="urgent-mark" role="img" aria-label="Urgent" title="Urgent">‼</span>}<a href={sessionHref(row.sessionId)}>{row.session}</a><span className="grow" />{row.moot?.label && <span className="chip warn-chip" data-moot="possibly-moot" title={row.moot.explanation}>{row.moot.label}</span>}{row.stale && <span className="chip warn-chip">{row.stale}</span>}<span className="faint tnum">{row.age}</span></div>
      <p className="card-text">{row.text}</p>
      <p className="muted question-activity">Updated {row.updated === '–' ? 'unknown' : <time dateTime={row.updatedAt ?? undefined}>{row.updated} ago</time>} · Last activity <time dateTime={row.lastActivityAt}>{row.lastActivity}</time></p>
      {row.options.length > 0 && <ul className="question-options" aria-label="Options (read-only)">{row.options.map((option, index) => <li key={option}><span className="muted">{String.fromCharCode(65 + index)} · </span>{option}</li>)}</ul>}
      <QuestionMootEvidence row={row} />
      <QuestionHistory row={row} />
    </li>
  );
}

/** Why the question is (or is not) marked: observed GitHub state per link. Advisory only; all text is rendered as text. */
function QuestionMootEvidence({ row }: { row: QuestionRow }) {
  if (!row.moot) return null;
  const { label, explanation, evidence } = row.moot;
  return (
    <details className="question-history question-moot">
      <summary>{label ?? 'Linked items'} · GitHub evidence ({evidence.length})</summary>
      <p className="question-history-note">{explanation}</p>
      <ul aria-label={`GitHub evidence for ${row.id}`}>{evidence.map(item => <li key={item.key}>{item.text}</li>)}</ul>
    </details>
  );
}

/** Native disclosure: Enter and Space on the summary, and its expanded state, come from the browser. Text is rendered as text. */
function QuestionHistory({ row }: { row: QuestionRow }) {
  if (!row.history) return <p className="faint question-history-note">History unavailable: this question predates recorded history.</p>;
  if (row.history.length === 0) return <p className="faint question-history-note">No history recorded.</p>;
  return (
    <details className="question-history">
      <summary>History ({row.history.length})</summary>
      <ol aria-label={`History of ${row.id}, newest first`}>
        {row.history.map(entry => (
          <li key={entry.key}>
            <time dateTime={entry.at}>{entry.at}</time> · <strong>{entry.operation}</strong> by {entry.actor} <span className="faint">({entry.age} ago)</span>
            {entry.withheld && <span className="faint"> · note withheld</span>}
            {entry.excerpt && <p className="question-history-note">{entry.excerpt}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}
