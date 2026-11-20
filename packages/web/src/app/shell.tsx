import { availableSections, bindingsFor, buildOverview, buildQuestions, sections, type ConsoleState, type SectionId } from '@pi-console/viewmodels';
import { hrefFor } from './routes.ts';
import { useConsole } from './hooks.ts';
import { Kbd } from '../ui/primitives.tsx';

export function badgeCounts(state: ConsoleState): Partial<Record<SectionId, number>> {
  return {
    overview: buildOverview(state).needs.length,
    questions: buildQuestions(state, { filter: 'blocking' }).rows.length,
  };
}

const sectionIcons: Record<SectionId, string> = {
  overview: '◉', fleet: '▤', requests: '⇄', questions: '?', messages: '⌬', timeline: '▭', work: '⚙', direct: '⌁', activity: '☰',
};

export function Sidebar({ active, collapsed, onToggle }: { active: string; collapsed: boolean; onToggle: () => void }) {
  const state = useConsole();
  const counts = badgeCounts(state);
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="brand"><span className="logo" aria-hidden="true">π</span><span className="brand-name">console</span></div>
      <ul>
        {sections.map(section => {
          const count = counts[section.id] ?? 0;
          const unavailable = !availableSections.includes(section.id);
          return (
            <li key={section.id}>
              <a href={hrefFor(section.id)} aria-current={active === section.id ? 'page' : undefined} className={unavailable ? 'dim' : ''} title={`${section.label}: ${section.hint}`}>
                <span className="nav-icon" aria-hidden="true">{sectionIcons[section.id]}</span>
                <span className="nav-label">{section.label}</span>
                {count > 0 && <span className={`nav-badge${section.id === 'overview' ? ' hot' : ''}`} aria-label={`${String(count)} need attention`}>{count}</span>}
                <Kbd>{section.key}</Kbd>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="sidebar-foot">
        <a href={hrefFor('settings')} aria-current={active === 'settings' ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">Settings</span><Kbd>,</Kbd></a>
        <button type="button" className="collapse" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? '»' : '«'}</button>
      </div>
    </nav>
  );
}

const connectionCopy = {
  connecting: { tone: 'violet', text: 'Connecting to the daemon…' },
  reconnecting: { tone: 'amber', text: 'Disconnected. Reconnecting and resuming from the last event…' },
  offline: { tone: 'red', text: 'The daemon is not reachable. Data below may be out of date. Retrying…' },
  unauthorized: { tone: 'red', text: 'The daemon rejected the token.' },
  live: { tone: 'green', text: 'Live' },
} as const;

export function ConnectionPill({ state }: { state: ConsoleState }) {
  const copy = connectionCopy[state.connection];
  return <span className={`conn tone-${copy.tone}`} role="status"><span className="dot" aria-hidden="true" />{state.connection === 'live' ? 'Live' : state.connection}</span>;
}

export function Banner({ state }: { state: ConsoleState }) {
  if (state.connection === 'live') return null;
  const copy = connectionCopy[state.connection];
  return <div className={`banner tone-${copy.tone}`} role="alert">{copy.text}</div>;
}

export function KeyHints({ scopes }: { scopes: Parameters<typeof bindingsFor> }) {
  const hints = bindingsFor(...scopes).filter(binding => !binding.mutating).slice(0, 12);
  return (
    <footer className="hints" aria-label="Keyboard hints">
      {hints.map(binding => <span key={binding.description}><Kbd>{binding.keys[0] === ' ' ? 'Space' : binding.keys[0]}</Kbd> {binding.description}</span>)}
      <span className="grow" /><span><Kbd>?</Kbd> Help</span>
    </footer>
  );
}
