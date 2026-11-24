import type { Session } from '@pi-console/contract';
import { clock, sessionLabels, statusCell } from '@pi-console/viewmodels';
import type { ConsoleState } from '../state/state.ts';
import { Kbd, StatusBadge } from '../ui/primitives.tsx';
import { FleetPulse } from './pulse.tsx';
import { attentionPresentation, type AttentionPresentation } from './attention.ts';
import { hrefFor, sectionIds, sectionMeta, type SectionId } from './routes.ts';

interface SidebarProps { active: SectionId | null; settings: boolean; attention: AttentionPresentation; questions: number; collapsed: boolean; onCollapse: () => void }

export function Sidebar({ active, settings, attention, questions, collapsed, onCollapse }: SidebarProps) {
  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sections">
      <div className="brand"><span className="logo" aria-hidden="true">π</span><span className="brand-name">pi console</span></div>
      <ul>
        {sectionIds.map((id, index) => (
          <li key={id}>
            <a href={hrefFor(id)} aria-labelledby={`nav-${id}-label nav-${id}-badge`} aria-current={active === id ? 'page' : undefined} title={sectionMeta[id].hint}>
              <span className="nav-icon" aria-hidden="true">{sectionMeta[id].icon}</span>
              <span className="nav-label" id={`nav-${id}-label`}>{sectionMeta[id].label}</span>
              {id === 'overview' && attention.glyph && <span id={`nav-${id}-badge`} className={`nav-badge${attention.status === 'ready' ? ' hot' : attention.status === 'unavailable' ? ' warn' : ''}`} aria-label={attention.label} title={attention.label} data-attention={attention.status}>{attention.glyph}</span>}
              {id === 'questions' && questions > 0 && <span id={`nav-${id}-badge`} className="nav-badge" aria-label={`${String(questions)} waiting`}>{questions}</span>}
              <Kbd>{index + 1}</Kbd>
            </a>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <a className="navlink" aria-label="Settings" href={hrefFor('settings')} aria-current={settings ? 'page' : undefined}><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">Settings</span><Kbd>,</Kbd></a>
        <button type="button" className="collapse" onClick={onCollapse} aria-pressed={collapsed}>{collapsed ? '»' : '« Collapse'}</button>
      </div>
    </nav>
  );
}

const connectionTone: Record<ConsoleState['connection'], string> = { live: 'green', connecting: 'amber', reconnecting: 'amber', offline: 'red', unauthorized: 'red' };

export const staleData = (state: ConsoleState, wall: number): boolean =>
  state.snapshotLoaded && (state.connection !== 'live' || (state.lastFrameAt > 0 && wall - state.lastFrameAt > 20_000));

interface TopBarProps { title: string; hint: string; state: ConsoleState; wall: number; session?: Session; onPalette: () => void; onHelp: () => void }

export function TopBar({ title, hint, state, wall, session, onPalette, onHelp }: TopBarProps) {
  const heading = session ? sessionLabels(session).title : title;
  return (
    <header className="topbar">
      <h1 id="content-heading" tabIndex={-1} className="crumb truncate" title={heading}>{heading}</h1>
      {session && <StatusBadge cell={statusCell(session.status)} />}
      {hint && <span className="muted">{hint}</span>}
      <span className="grow" />
      <FleetPulse sessions={state.sessions} attention={attentionPresentation(state)} />
      {staleData(state, wall) && <time className="stale-asof muted" dateTime={new Date(state.lastFrameAt).toISOString()}>As of {clock(new Date(state.lastFrameAt).toISOString())}</time>}
      <span className={`conn tone-${connectionTone[state.connection]}`} role="status" data-connection={state.connection}><span className="dot" />{state.connection}</span>
      <button type="button" className="btn ghost" onClick={onPalette}>Palette <Kbd>:</Kbd></button>
      <button type="button" className="btn ghost" onClick={onHelp}>Help <Kbd>?</Kbd></button>
    </header>
  );
}

/** Visible stale/disconnected banner: the screen never silently shows old data as live. */
export function Banner({ state, wall }: { state: ConsoleState; wall: number }) {
  const silent = state.lastFrameAt > 0 && wall - state.lastFrameAt > 20_000 && state.connection === 'live';
  if (state.connection === 'live' && !silent) return null;
  const text = state.connection === 'connecting' ? 'Connecting to the daemon…'
    : silent ? 'No frames'
      : `Disconnected: showing the last data received${state.seq > 0 ? ` (event ${String(state.seq)})` : ''}. Reconnecting…`;
  return <div className={`banner tone-${state.connection === 'connecting' ? 'amber' : 'red'}`} data-testid="banner"><span role="alert">{text}</span>{silent && <> for {Math.round((wall - state.lastFrameAt) / 1000)}s: the data below may be stale.</>}</div>;
}

export function Hints({ items }: { items: string[] }) {
  return <footer className="hints" aria-label="Key hints">{items.map(item => { const [key, ...rest] = item.split(' '); return <span key={item}><Kbd>{key}</Kbd>{rest.join(' ')}</span>; })}</footer>;
}
