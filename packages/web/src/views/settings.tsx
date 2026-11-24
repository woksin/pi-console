import { daemonHealthRows, pressureGradient, settingsViewModel, themePreview, type SettingsRow } from '@pi-console/viewmodels';
import type { CSSProperties } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { Panel } from '../ui/primitives.tsx';
import { setMotionChoice, setPrefs, usePrefs, type MotionChoice } from '../app/prefs.ts';
import { colorsFor, themeIds, type ThemeId } from '../app/theme.ts';
import { settingsTimestamp } from './settings-format.ts';
import { healthGroups } from './settings-health.ts';

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

const rows = (items: SettingsRow[]) => <dl className="kv wide">{items.map(row => <div key={row.label}><dt>{row.label}{row.detail && <>{' '}<span className="row-id faint small mono">{row.detail}</span></>}</dt><dd className={`tone-text-${row.tone}`}><SettingValue value={row.value} /></dd></div>)}</dl>;

/** Sources, Event log and Stream in plain units; every raw daemon value, including unknown keys, stays under Details. */
function DaemonHealth({ health, sources }: { health: unknown; sources: SettingsRow[] }) {
  const raw = daemonHealthRows(health);
  return (
    <Panel title="Daemon health" className="health-panel">
      {healthGroups(health, sources).map(group => <section key={group.title} className="health-group" aria-label={group.title}><h4>{group.title}</h4>{rows(group.rows)}</section>)}
      {raw.length > 0 && <details className="health-details"><summary>Details</summary>{rows(raw)}</details>}
    </Panel>
  );
}

const motionChoices: readonly (readonly [MotionChoice, string])[] = [['system', 'System'], ['on', 'On'], ['off', 'Off']];

function Appearance() {
  const prefs = usePrefs();
  return (
    <Panel title="Appearance">
      <div className="theme-cards" role="group" aria-label="Theme">{themeIds.map((id: ThemeId) => <ThemeCard key={id} id={id} current={prefs.theme === id} />)}</div>
      <div className="motion-control"><span id="motion-label">Reduce motion</span>
        <div className="seg" role="group" aria-labelledby="motion-label">{motionChoices.map(([choice, label]) => <button key={choice} type="button" aria-pressed={prefs.motionChoice === choice} onClick={() => { setMotionChoice(choice); }}>{label}</button>)}</div>
      </div>
    </Panel>
  );
}

export function SettingsView({ state, now }: ViewProps) {
  const view = settingsViewModel({
    endpoint: window.location.origin, connected: state.connection === 'live', error: state.connection === 'unauthorized' ? 'token rejected' : state.connection,
    tokenSource: 'this tab (session storage)', lastSeq: state.seq > 0 ? state.seq : undefined, lastEventAt: state.lastFrameAt > 0 ? state.lastFrameAt : undefined,
    eventsReceived: state.received, now: state.lastFrameAt > 0 ? Math.max(now, state.lastFrameAt) : now,
    daemonHealth: state.health,
    counts: { repositories: state.repositories.length, sessions: state.totals?.sessions ?? state.sessions.length, requests: state.totals?.requests ?? state.requests.length, questions: state.totals?.questions ?? state.questions.length, messages: state.totals?.messages ?? state.messages.length, jobs: state.totals?.jobs ?? state.jobs.length },
  });
  return (
    <div className="page settings">
      <Panel title="Connection">{rows(view.health)}</Panel>
      <Panel title="Data">{rows(view.data)}</Panel>
      <DaemonHealth health={state.health} sources={view.sources} />
      <Appearance />
    </div>
  );
}
