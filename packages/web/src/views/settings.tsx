import { daemonHealthRows, pressureGradient, settingsViewModel, themePreview, type SettingsRow } from '@pi-console/viewmodels';
import type { CSSProperties } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { Panel } from '../ui/primitives.tsx';
import { setPrefs, usePrefs } from '../app/prefs.ts';
import { colorsFor, themeIds, type ThemeId } from '../app/theme.ts';
import { settingsTimestamp } from './settings-format.ts';

const preview = themePreview();

/** One theme drawn in its own colours with the samples the TUI Settings shows; picking it applies the theme. */
function ThemeCard({ id, current }: { id: ThemeId; current: boolean }) {
  const colors = colorsFor(id);
  const vars = Object.fromEntries([...Object.entries(colors).map(([token, hex]) => [`--${token}`, hex]), ['--pressure-gradient', pressureGradient(colors)]]) as CSSProperties;
  return (
    <button type="button" className="theme-card" style={vars} aria-label={`${id} theme`} aria-pressed={current} onClick={() => { setPrefs({ theme: id }); }}>
      <span className="theme-card-name">{id}{current && <span className="muted"> · in use</span>}</span>
      <span className="theme-card-statuses">{preview.statuses.map(sample => <span key={sample.text} className={`tone-${sample.color}`}>{sample.text}</span>)}</span>
      <span className="theme-card-text">{preview.text.map(sample => <span key={sample.text} className={sample.color}>{sample.text}</span>)}<span className="theme-card-ramp" aria-hidden="true" /></span>
    </button>
  );
}

function SettingValue({ value }: { value: string }) {
  const timestamp = settingsTimestamp(value);
  return timestamp ? <time dateTime={value} title={value}>{timestamp}</time> : <>{value}</>;
}

const rows = (items: SettingsRow[]) => <dl className="kv wide">{items.map(row => <div key={row.label}><dt>{row.label}</dt><dd className={`tone-text-${row.tone}`}><SettingValue value={row.value} /></dd></div>)}</dl>;

export function SettingsView({ state, now }: ViewProps) {
  const prefs = usePrefs();
  const view = settingsViewModel({
    endpoint: window.location.origin, connected: state.connection === 'live', error: state.connection === 'unauthorized' ? 'token rejected' : state.connection,
    tokenSource: 'this tab (session storage)', lastSeq: state.seq > 0 ? state.seq : undefined, lastEventAt: state.lastFrameAt > 0 ? state.lastFrameAt : undefined,
    eventsReceived: state.received, now: state.lastFrameAt > 0 ? Math.max(now, state.lastFrameAt) : now,
    daemonHealth: state.health,
    counts: { repositories: state.repositories.length, sessions: state.totals?.sessions ?? state.sessions.length, requests: state.totals?.requests ?? state.requests.length, questions: state.totals?.questions ?? state.questions.length, messages: state.totals?.messages ?? state.messages.length, jobs: state.totals?.jobs ?? state.jobs.length },
  });
  const health = daemonHealthRows(state.health);
  return (
    <div className="page settings">
      <Panel title="Connection">{rows(view.health)}</Panel>
      <Panel title="Data">{rows(view.data)}</Panel>
      <Panel title="Sources">{rows(view.sources)}</Panel>
      {health.length > 0 && <Panel title="Daemon health">{rows(health)}</Panel>}
      <Panel title="Appearance">
        <div className="theme-cards" role="group" aria-label="Theme">{themeIds.map((id: ThemeId) => <ThemeCard key={id} id={id} current={prefs.theme === id} />)}</div>
        <label className="check"><input type="checkbox" checked={prefs.reducedMotion} onChange={event => { setPrefs({ reducedMotion: event.target.checked }); }} /> Reduce motion</label>
      </Panel>
    </div>
  );
}
