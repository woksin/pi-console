import { settingsViewModel, type SettingsRow } from '@pi-console/viewmodels';
import type { ViewProps } from '../app/view.tsx';
import { Panel } from '../ui/primitives.tsx';
import { setPrefs, usePrefs } from '../app/prefs.ts';
import { themeIds, type ThemeId } from '../app/theme.ts';

const rows = (items: SettingsRow[]) => <dl className="kv wide">{items.map(row => <div key={row.label}><dt>{row.label}</dt><dd className={`tone-text-${row.tone}`}>{row.value}</dd></div>)}</dl>;

export function SettingsView({ state, now }: ViewProps) {
  const prefs = usePrefs();
  const view = settingsViewModel({
    endpoint: window.location.origin, connected: state.connection === 'live', error: state.connection === 'unauthorized' ? 'token rejected' : state.connection,
    tokenSource: 'this tab (session storage)', lastSeq: state.seq > 0 ? state.seq : undefined, lastEventAt: state.lastFrameAt > 0 ? state.lastFrameAt : undefined,
    eventsReceived: state.received, now: state.lastFrameAt > 0 ? Math.max(now, state.lastFrameAt) : now,
    counts: { repositories: state.repositories.length, sessions: state.sessions.length, requests: state.requests.length, questions: state.questions.length, messages: state.messages.length, jobs: state.jobs.length },
  });
  const health = state.health ? Object.entries(state.health).map(([label, value]): SettingsRow => ({ label, value: String(value), tone: 'plain' })) : [];
  return (
    <div className="page settings">
      <Panel title="Connection">{rows(view.health)}</Panel>
      <Panel title="Data">{rows(view.data)}</Panel>
      <Panel title="Sources">{rows(view.sources)}</Panel>
      {health.length > 0 && <Panel title="Daemon health">{rows(health)}</Panel>}
      <Panel title="Appearance">
        <div className="seg" role="group" aria-label="Theme">{themeIds.map((id: ThemeId) => <button key={id} type="button" aria-pressed={prefs.theme === id} onClick={() => { setPrefs({ theme: id }); }}>{id}</button>)}</div>
        <label className="check"><input type="checkbox" checked={prefs.reducedMotion} onChange={event => { setPrefs({ reducedMotion: event.target.checked }); }} /> Reduce motion</label>
      </Panel>
    </div>
  );
}
