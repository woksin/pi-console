import { overviewViewModel } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, Panel, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

export function OverviewView({ state, now }: ViewProps) {
  const view = useMemo(() => overviewViewModel({ needsYou: state.needsYou, sessions: state.sessions, repositories: state.repositories.length, now }), [state.needsYou, state.sessions, state.repositories.length, now]);
  const byId = new Map(view.cards.map(card => [card.id, card]));
  const nav = useListNav(view.cards.map(card => card.id), { onOpen: id => { const card = byId.get(id); if (card?.sessionId) navigate(sessionHref(card.sessionId, card.pointer?.entryId)); } });
  return (
    <div className="page overview">
      <section className={`hero${view.cards.length === 0 ? ' clear' : ''}`} aria-labelledby="needs-you">
        <h2 id="needs-you" className="hero-title">{view.headline}</h2>
        <p className="muted">Ranked by the daemon. Open an item to jump to the exact line in its session.</p>
      </section>
      <div className="overview-grid">
        <ol className="cards" aria-label="Needs you">
          {view.cards.map(card => <AttentionCard key={card.id} card={card} selected={nav.selected === card.id} onSelect={() => { nav.select(card.id); }} />)}
          {view.cards.length === 0 && <li><EmptyState title="Nothing needs you" mark="✓">Open requests, blocking questions and stale sessions appear here the moment they exist.</EmptyState></li>}
        </ol>
        <aside className="rail">
          <Panel title="Fleet" aside={`${String(view.fleet.repositories)} repositories`}>
            <dl className="kv"><div><dt>Sessions</dt><dd>{view.fleet.sessions}</dd></div><div><dt>Working</dt><dd>{view.fleet.working}</dd></div><div><dt>Tokens</dt><dd>{view.fleet.tokens}</dd></div><div><dt>Cost</dt><dd>{view.fleet.cost}</dd></div></dl>
            <Sparkline values={view.fleet.contextSeries} width={240} height={44} fill label="Fleet context pressure" />
            <span className="faint small">Average context use across the fleet</span>
          </Panel>
          <Panel title="By status">
            <ul className="mini-list">{view.counts.map(entry => <li key={entry.status.status}><StatusBadge cell={entry.status} /><span className="tnum">{entry.count}</span></li>)}</ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function AttentionCard({ card, selected, onSelect }: { card: ReturnType<typeof overviewViewModel>['cards'][number]; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card tone-${card.status.color}${selected ? ' selected' : ''}`} data-reason={card.reason} aria-current={selected || undefined} onClick={onSelect}>
      <div className="card-head"><StatusBadge cell={card.status} /><strong>{card.reasonLabel}</strong><span className="grow" /><span className="faint tnum">{card.age}</span></div>
      <div className="card-title">{card.title}</div>
      <p className="card-text">{card.text}</p>
      {card.sessionId && <a className="btn ghost" href={sessionHref(card.sessionId, card.pointer?.entryId)}>Open in session →</a>}
    </li>
  );
}
