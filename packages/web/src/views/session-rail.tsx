import type { SessionViewModel } from '@pi-console/viewmodels';
import { PressureBar, Panel, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { sessionHref } from '../app/routes.ts';
import { SessionMemory } from './session-memory.tsx';

export function SessionHeader({ view }: { view: SessionViewModel }) {
  return (
    <header className="session-head">
      <div><h2>{view.title}</h2><div className="muted small mono">{view.cwd} · {view.branch} · {view.model} · {view.role}</div></div>
      <StatusBadge cell={view.status} /><span className="muted tnum">{view.cost}</span><span className="muted tnum">updated {view.age} ago</span>
    </header>
  );
}

const sparkOf = (glyphs: string): number[] => Array.from(glyphs, glyph => '▁▂▃▄▅▆▇█'.indexOf(glyph) + 1);

export function SessionRail({ view }: { view: SessionViewModel }) {
  return (
    <aside className="rail" aria-label="Session details">
      <Panel title="Context"><PressureBar percent={view.context.percent} pressure={view.context.pressure} /><Sparkline values={sparkOf(view.context.spark)} width={240} height={40} fill label="Context over time" /></Panel>
      <Panel title="Requests" aside={view.requests.length}>
        <ul className="mini-list stacked">{view.requests.map(request => <li key={request.id}><StatusBadge cell={request.status} compact /><span className="truncate" title={request.text}>{request.text}</span></li>)}</ul>
        {view.requests.length === 0 && <span className="faint">None observed</span>}
      </Panel>
      <Panel title="Questions" aside={view.questions.length}>
        <ul className="mini-list stacked">{view.questions.map(question => <li key={question.id}><span className={question.blocking ? 'warn-text' : 'muted'}>{question.blocking ? '⛔' : '?'}</span><span>{question.text}</span></li>)}</ul>
        {view.questions.length === 0 && <span className="faint">None</span>}
      </Panel>
      <Panel title="Jobs" aside={view.jobs.length}>
        <ul className="mini-list">{view.jobs.map(job => <li key={job.id}><span className="truncate">{job.name}</span><StatusBadge cell={job.status} compact />{job.exit && <span className="faint small">{job.exit}</span>}</li>)}</ul>
        {view.jobs.length === 0 && <span className="faint">None</span>}
      </Panel>
      <Panel title="Resets" aside={view.resets.length}>
        <ul className="mini-list">{view.resets.map(reset => <li key={reset.id}><span>┃ {reset.kind}</span><span className="faint small">{reset.time} · {reset.carried} carried · {reset.interrupted} interrupted</span></li>)}</ul>
        {view.resets.length === 0 && <span className="faint">None</span>}
      </Panel>
      <SessionMemory id={view.id} />
      {view.subagents.length > 0 && <Panel title="Subagents" aside={view.subagents.length}>
        <ul className="mini-list">{view.subagents.map(sub => <li key={sub.id}><a href={sessionHref(sub.id)}>{sub.name}</a><StatusBadge cell={sub.status} compact /></li>)}</ul>
      </Panel>}
    </aside>
  );
}
