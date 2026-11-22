import { overviewEmpty, overviewViewModel, pressureHistogram, type PressureHistogram } from '@pi-console/viewmodels';
import { useMemo } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { navigate, useListNav, useStore } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { SkeletonRows, Sparkline, StatusBadge } from '../ui/primitives.tsx';
import { EmptyFor, FirstRun } from '../ui/empty.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';
import { groupAttentionCards } from './overview-sections.ts';
import { useNewSince, useStatusFlash } from './overview-changes.ts';

export function OverviewView({ state, now }: ViewProps) {
  const view = useMemo(() => overviewViewModel({ needsYou: state.needsYou, sessions: state.sessions, repositories: state.repositories.length, now }), [state.needsYou, state.sessions, state.repositories.length, now]);
  const ready = state.needsYouLoaded && !state.needsYouError;
  const histogram = useMemo(() => pressureHistogram(state.sessions), [state.sessions]);
  const byId = new Map(view.cards.map(card => [card.id, card]));
  const sections = groupAttentionCards(view.cards);
  const fresh = useNewSince(view.cards.map(card => card.id), state.snapshotLoaded && state.needsYouLoaded);
  const nav = useListNav(sections.flatMap(section => section.cards.map(card => card.id)), { onOpen: id => { const card = byId.get(id); if (card?.sessionId) navigate(sessionHref(card.sessionId, card.pointer?.entryId)); } });
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="overview" /></div>;
  return (
    <div className="page overview">
      <section className={`hero${ready && view.cards.length === 0 ? ' clear' : ''}`} aria-labelledby="needs-you">
        <AttentionSummary state={state} headline={view.headline} />
        <p className="muted">{view.fleet.sessions} sessions · {view.fleet.repositories} repositories · {view.fleet.tokens} tokens · {view.fleet.cost}</p>
      </section>
      {state.sessions.length > 0 && <div className="summary-strip" aria-label="Fleet summary">
        <div className="summary-counts">{view.counts.map(entry => <span key={entry.status.status}><StatusBadge cell={entry.status} /> {entry.count}</span>)}</div>
        <Sparkline values={view.fleet.contextSeries} width={90} height={20} fill label="Average fleet context pressure" />
        <PressureHistogramFigure histogram={histogram} />
      </div>}
      <div className="attention-sections" aria-label="Needs you">
        {fresh.label && <p className="new-since" role="status"><span>{fresh.label}</span></p>}
        {sections.map(section => <section key={section.cards[0].id} aria-label={section.label}>
          <h3 className="attention-heading">{section.label} <span className="faint">{section.cards.length}</span></h3>
          <ol className="cards">{section.cards.map(card => <AttentionCard key={card.id} card={card} isNew={fresh.ids.has(card.id)} selected={nav.selected === card.id} onSelect={() => { nav.select(card.id); }} />)}</ol>
        </section>)}
        <AttentionEmpty state={state} ready={ready} empty={view.cards.length === 0} working={view.fleet.working} />
      </div>
    </div>
  );
}

function AttentionEmpty({ state, ready, empty, working }: { state: ViewProps['state']; ready: boolean; empty: boolean; working: number }) {
  if (!ready || !empty) return null;
  return state.sessions.length === 0 ? <FirstRun connected={state.connection === 'live'} sessions={0} /> : <EmptyFor model={overviewEmpty(working)} />;
}

function AttentionSummary({ state, headline }: { state: ViewProps['state']; headline: string }) {
  const store = useStore();
  if (state.needsYouError) return <div role="alert">
    <h2 id="needs-you" className="hero-title">Could not load needs you.</h2>
    <button onClick={() => { void store.refresh(); }}>Retry</button>
  </div>;
  if (!state.needsYouLoaded) return <h2 id="needs-you" className="hero-title" role="status">Loading…</h2>;
  return <h2 id="needs-you" className="hero-title">{headline}</h2>;
}

/** Sessions per context-pressure bin; each bar takes its colour from its place on the shared pressure ramp, with the 60 and 80 % ticks. */
function PressureHistogramFigure({ histogram }: { histogram: PressureHistogram }) {
  const last = histogram.bins.length - 1;
  return (
    <figure className="pressure-hist" role="img" aria-label={`Context pressure: ${histogram.summary}`} title={histogram.summary}>
      <span className="pressure-hist-bars" aria-hidden="true">
        {histogram.bins.map((bin, index) => <i key={bin.from} className={bin.count === 0 ? 'zero' : undefined} title={`${bin.label}: ${String(bin.count)}`}
          style={{ height: `${String(bin.count === 0 ? 2 : 4 + bin.count / histogram.peak * 18)}px`, backgroundPositionX: `${String(index / last * 100)}%` }} />)}
        {histogram.ticks.map(tick => <b key={tick} className="pressure-hist-tick" style={{ left: `${String(tick)}%` }} />)}
      </span>
      <figcaption aria-hidden="true"><span className="hot">{histogram.hot}</span> &gt;80 · <span className="warm">{histogram.warm}</span> 60–80</figcaption>
    </figure>
  );
}

interface CardProps { card: ReturnType<typeof overviewViewModel>['cards'][number]; isNew: boolean; selected: boolean; onSelect: () => void }

function AttentionCard({ card, isNew, selected, onSelect }: CardProps) {
  const ref = useScrollIntoView<HTMLLIElement>(selected);
  const flash = useStatusFlash(card.id, card.status.status);
  const classes = ['card', `tone-${card.status.color}`, selected && 'selected', isNew && 'is-new', flash && 'flash'].filter(Boolean).join(' ');
  return (
    <li ref={ref} className={classes} data-reason={card.reason} aria-current={selected || undefined} onClick={onSelect}>
      <div className="card-head"><StatusBadge cell={card.status} /><strong className="truncate" title={card.title}>{card.title}</strong>{isNew && <span className="new-tag">new</span>}<span className="grow" /><span className="faint tnum">{card.age}</span></div>
      <div className="attention-body"><p className="card-text" title={card.text}>{card.text}</p>
        {card.sessionId && <a href={sessionHref(card.sessionId, card.pointer?.entryId)}>Open in session →</a>}
      </div>
    </li>
  );
}
