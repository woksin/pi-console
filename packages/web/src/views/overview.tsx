import { buildOverview, type NeedCard, type OverviewViewModel } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import { navigate, useConsole } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { useSelection } from '../app/hooks.ts';
import { EmptyState, Kbd, Panel, PressureBar, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

function Card({ card, selected, onSelect }: { card: NeedCard; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLElement>(selected);
  const open = (): void => { if (card.session) navigate(sessionHref(card.session.id, card.pointer?.entryId)); };
  return (
    <article ref={ref} className={`card tone-${card.badge.color}${selected ? ' selected' : ''}`} aria-current={selected} onClick={onSelect}>
      <header className="card-head">
        <StatusBadge badge={card.badge} />
        <strong>{card.title}</strong>
        <span className="muted grow">{card.session?.label ?? 'No session'}</span>
        <time className="muted tnum">{card.age}</time>
      </header>
      <p className="card-text">{card.text}</p>
      {card.question && (
        <div className="options" aria-label="Answer options (read-only in M1)">
          {card.question.options.map(option => (
            <button key={option.key} type="button" className="chip" disabled title="Read-only in M1: answering arrives with control features">
              <Kbd>{option.key}</Kbd>{option.text}
            </button>
          ))}
        </div>
      )}
      <footer className="card-foot">
        {card.request && <span className="muted">{card.request.origin} · {card.request.status}</span>}
        <span className="grow" />
        <button type="button" className="btn primary" disabled={!card.session} onClick={open}>
          {card.pointer ? 'Open at the request' : 'Open session'} <Kbd>↵</Kbd>
        </button>
      </footer>
    </article>
  );
}

function Hero({ model }: { model: OverviewViewModel }) {
  return (
    <header className={`hero${model.empty ? ' calm' : ''}`}>
      <span className="hero-orb" aria-hidden="true" />
      <div>
        <h1>{model.headline}</h1>
        <p className="muted">{model.working.ratioText} working · median context {model.working.contextMedian}% · {model.working.cost} spent this window</p>
      </div>
    </header>
  );
}

function WorkingPanel({ model }: { model: OverviewViewModel }) {
  const { working } = model;
  return (
    <Panel title="Working" aside={working.ratioText}>
      <div className="meter" role="img" aria-label={working.ratioText}><span style={{ width: `${String(Math.round(working.ratio * 100))}%` }} /></div>
      <div className="spark-wide"><Sparkline values={working.tokenTrend} width={320} height={64} fill label="Token burn" /></div>
      <p className="muted small">Fleet token burn per sample</p>
      <ul className="mini-list">
        {working.sessions.map(session => (
          <li key={session.id}><a href={sessionHref(session.id)}>{session.laneId} {session.name}</a><PressureBar pressure={session.pressure} /></li>
        ))}
      </ul>
    </Panel>
  );
}

export function OverviewView() {
  const state = useConsole();
  const model = useMemo(() => buildOverview(state), [state]);
  const [selected, setSelected, move, jump] = useSelection(model.needs.map(card => card.id));
  useCommands(command => {
    if (command.type === 'move') { move(command.delta); return true; }
    if (command.type === 'top' || command.type === 'bottom') { jump(command.type); return true; }
    if (command.type !== 'open') return false;
    const card = model.needs.find(item => item.id === selected);
    if (card?.session) navigate(sessionHref(card.session.id, card.pointer?.entryId));
    return card !== undefined;
  });
  return (
    <div className="page overview">
      <Hero model={model} />
      <div className="columns two">
        <section aria-label="Needs you" className="stack">
          {model.empty && <EmptyState title="Nothing needs you." mark="◌">Agents ask here when they need you. {model.working.count} working right now.</EmptyState>}
          {model.needs.map(card => <Card key={card.id} card={card} selected={card.id === selected} onSelect={() => { setSelected(card.id); }} />)}
        </section>
        <aside className="stack">
          <WorkingPanel model={model} />
          {model.blocked.length > 0 && (
            <Panel title="Blocked or failed" aside={String(model.blocked.length)}>
              <ul className="mini-list">{model.blocked.map(session => <li key={session.id}><a href={sessionHref(session.id)}>{session.laneId} {session.name}</a><StatusBadge badge={session.badge} /></li>)}</ul>
            </Panel>
          )}
          <Panel title="Host">
            <dl className="kv">{model.host.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
