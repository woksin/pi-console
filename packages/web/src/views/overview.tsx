import { attentionSections, overviewViewModel } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, SkeletonRows, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

export function OverviewView({ state, now }: ViewProps) {
  const view = useMemo(() => overviewViewModel({ needsYou: state.needsYou, sessions: state.sessions, repositories: state.repositories.length, now }), [state.needsYou, state.sessions, state.repositories.length, now]);
  const byId = new Map(view.cards.map(card => [card.id, card]));
  const nav = useListNav(view.cards.map(card => card.id), { onOpen: id => { const card = byId.get(id); if (card?.sessionId) navigate(sessionHref(card.sessionId, card.pointer?.entryId)); } });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="overview" /></div>;
  return (
    <div className="page overview">
      <section className={`hero${view.cards.length === 0 ? ' clear' : ''}`} aria-labelledby="needs-you">
        <h2 id="needs-you" className="hero-title">{view.headline}</h2>
        <p className="muted">Ranked by the daemon. Open an item to jump to the exact line in its session.</p>
      </section>
      <div className="summary-strip" aria-label="Fleet summary">
        <span>{view.fleet.sessions} sessions · {view.fleet.repositories} repositories</span>
        <span>{view.fleet.tokens} tokens · {view.fleet.cost}</span>
        <Sparkline values={view.fleet.contextSeries} width={90} height={20} fill label="Average fleet context pressure" />
        {view.counts.map(entry => <span key={entry.status.status}><StatusBadge cell={entry.status} /> {entry.count}</span>)}
      </div>
      <div className="attention-sections" aria-label="Needs you">
        {attentionSections(view.cards).map((section, index) => <section key={index} aria-label={section.label}>
          <h3 className="attention-heading">{section.label} <span className="faint">{section.cards.length}</span></h3>
          <ol className="cards">{section.cards.map(card => <AttentionCard key={card.id} card={card} selected={nav.selected === card.id} onSelect={() => { nav.select(card.id); }} />)}</ol>
        </section>)}
        {view.cards.length === 0 && <EmptyState title="Nothing needs you" mark="✓">Open requests, blocking questions and stale sessions appear here the moment they exist.</EmptyState>}
      </div>
    </div>
  );
}

function AttentionCard({ card, selected, onSelect }: { card: ReturnType<typeof overviewViewModel>['cards'][number]; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  return (
    <li ref={ref} className={`card tone-${card.status.color}${selected ? ' selected' : ''}`} data-reason={card.reason} aria-current={selected || undefined} onClick={onSelect}>
      <div className="card-head"><StatusBadge cell={card.status} /><strong className="truncate" title={card.title}>{card.title}</strong><span className="grow" /><span className="faint tnum">{card.age}</span></div>
      <div className="attention-body"><p className="card-text" title={card.text}>{card.text}</p>
        {card.sessionId && <a href={sessionHref(card.sessionId, card.pointer?.entryId)}>Open in session →</a>}
      </div>
    </li>
  );
}
