import { buildSession, type SessionViewModel } from '@pi-console/viewmodels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, navigate, useConsole, useStore } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { useViewFocus } from '../app/focus.ts';
import { hrefFor, sessionHref } from '../app/routes.ts';
import { EmptyState, Kbd, Panel, PressureBar, SearchBox, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { Entry } from './transcript.tsx';

function Rail({ model }: { model: SessionViewModel }) {
  const { rail } = model;
  return (
    <aside className="rail">
      <Panel title="Context" aside={model.header?.pressure.label}>
        {model.header && <PressureBar pressure={model.header.pressure} wide />}
        <Sparkline values={rail.context.values} marks={rail.context.resetIndexes} width={240} height={44} fill label="Context pressure" />
        <p className="muted small">Vertical ticks mark resets.</p>
      </Panel>
      <Panel title="Requests" aside={String(rail.requests.length)}>
        <ul className="mini-list stacked">{rail.requests.map(request => (
          <li key={request.id}>
            <StatusBadge badge={request.badge} compact />
            {request.entryId ? <a href={sessionHref(model.header?.id ?? '', request.entryId)}>{request.text}</a> : <a href={hrefFor('requests', request.id)}>{request.text}</a>}
          </li>
        ))}</ul>
        {rail.requests.length === 0 && <p className="muted small">No requests.</p>}
      </Panel>
      <Panel title="Questions" aside={String(rail.questions.length)}>
        <ul className="mini-list stacked">{rail.questions.map(question => <li key={question.id}><StatusBadge badge={question.badge} compact /><a href={hrefFor('questions', question.id)}>{question.text}</a></li>)}</ul>
        {rail.questions.length === 0 && <p className="muted small">No questions.</p>}
      </Panel>
      <Panel title="Subagents" aside={String(rail.subagents.length)}>
        <ul className="mini-list">{rail.subagents.map(sub => <li key={sub.id}><a href={sessionHref(sub.id)}>{sub.label}</a><StatusBadge badge={sub.badge} compact /></li>)}</ul>
        {rail.subagents.length === 0 && <p className="muted small">None.</p>}
      </Panel>
      <Panel title="Jobs" aside={String(rail.jobs.length)}>
        <ul className="mini-list">{rail.jobs.map(job => <li key={job.id}><span className="truncate">{job.name}</span><StatusBadge badge={job.badge} compact /></li>)}</ul>
        {rail.jobs.length === 0 && <p className="muted small">None.</p>}
      </Panel>
    </aside>
  );
}

export function SessionView({ sessionId, entry }: { sessionId: string; entry: string | null }) {
  const state = useConsole();
  const store = useStore();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(entry === null);
  const [limit, setLimit] = useState(300);
  const scroller = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const model = useMemo(() => buildSession(state, sessionId, { expanded, query, targetEntryId: entry, limit }), [state, sessionId, expanded, query, entry, limit]);
  useEffect(() => { void store.loadTranscript(sessionId); }, [store, sessionId, state.gapCount]);
  useEffect(() => { setFollow(entry === null); }, [entry, sessionId]);
  useViewFocus(search);
  const last = model.rows.at(-1)?.id;
  useEffect(() => { if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [follow, last, model.rows.length]);
  useCommands(command => {
    if (command.type === 'toggleFollow') { setFollow(value => !value); return true; }
    if (command.type === 'back') { navigate(hrefFor('fleet')); return true; }
    if (command.type === 'copyId') { void copyText(sessionId); return true; }
    return false;
  });
  if (!model.found || !model.header) return <div className="page"><EmptyState title="Session not found." mark="?"><a href={hrefFor('fleet')}>Back to Fleet</a></EmptyState></div>;
  const header = model.header;
  const toggle = (id: string): void => { setExpanded(list => list.includes(id) ? list.filter(item => item !== id) : [...list, id]); };
  return (
    <div className="page session">
      <header className="session-head">
        <a className="back" href={hrefFor('fleet')} aria-label="Back to Fleet">←</a>
        <div className="grow">
          <h1>{header.name} <StatusBadge badge={header.status} /></h1>
          <p className="muted small mono">{header.laneId} · {header.branch} · {header.model} · {header.cwd}{header.parent && <> · child of {header.parent}</>}</p>
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder="Search this transcript" inputRef={search} />
        <button type="button" className="btn" aria-pressed={follow} onClick={() => { setFollow(value => !value); }}>Follow <Kbd>f</Kbd></button>
      </header>
      <div className="session-body">
        <div className="transcript-wrap">
          <div className="transcript" ref={scroller} tabIndex={0} aria-label="Transcript"
            onScroll={event => { const el = event.currentTarget; const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (!atEnd && follow) setFollow(false); }}>
            {model.hiddenBefore > 0 && <button type="button" className="btn more" onClick={() => { setLimit(value => value + 300); }}>Show {Math.min(300, model.hiddenBefore)} earlier entries ({model.hiddenBefore} hidden)</button>}
            {model.rows.length === 0 && <EmptyState title="No transcript entries yet." mark="…">Loading history from the daemon.</EmptyState>}
            {model.rows.map(row => <Entry key={row.id} row={row} onToggle={toggle} />)}
            {entry !== null && !model.targetFound && model.rows.length > 0 && <p className="note">The linked entry is outside the retained transcript.</p>}
          </div>
          {!follow && <button type="button" className="btn primary jump" onClick={() => { setFollow(true); }}>Jump to live ↓</button>}
          {query && <span className="match-count">{model.matches} matches</span>}
        </div>
        <Rail model={model} />
      </div>
    </div>
  );
}
