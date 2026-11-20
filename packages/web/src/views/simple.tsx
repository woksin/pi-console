import { buildActivity, buildSettings, buildWork, sections, type WorkFilter } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import { useConsole } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { setPrefs, usePrefs } from '../app/prefs.ts';
import { themeIds, type ThemeId } from '../app/theme.ts';
import { EmptyState, Panel, StatusBadge, Tabs } from '../ui/primitives.tsx';

export function WorkView() {
  const state = useConsole();
  const [filter, setFilter] = useState<WorkFilter>('all');
  const model = useMemo(() => buildWork(state, { filter }), [state, filter]);
  if (model.empty) return <div className="page"><EmptyState title="No jobs, phases or CI runs yet." mark="◌">Work the daemon observes (background jobs, orchestration phases, CI) appears here.</EmptyState></div>;
  return (
    <div className="page">
      <header className="toolbar"><Tabs tabs={model.tabs} value={filter} onChange={setFilter} label="Work filter" /></header>
      <table className="grid">
        <thead><tr><th>Status</th><th>Kind</th><th>Name</th><th>Session</th><th className="num">Started</th><th>Exit</th></tr></thead>
        <tbody>{model.rows.map(row => (
          <tr key={row.id} className="row"><td><StatusBadge badge={row.badge} /></td><td><span className="pill">{row.kind}</span></td><td>{row.name}</td>
            <td><a href={sessionHref(row.sessionId)}>{row.session}</a></td><td className="num muted tnum">{row.age}</td><td className="mono muted">{row.exit}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function ActivityView() {
  const model = buildActivity(useConsole());
  if (model.empty) return <div className="page"><EmptyState title={model.emptyText} mark="◌" /></div>;
  return (
    <div className="page">
      <table className="grid"><thead><tr><th>When</th><th>Action</th><th>Session</th><th>Text</th><th>Actor</th><th>Result</th></tr></thead>
        <tbody>{model.rows.map(row => <tr key={row.id} className="row"><td className="muted tnum">{row.age}</td><td><span className="pill">{row.type}</span></td><td><a href={sessionHref(row.sessionId)}>{row.session}</a></td><td>{row.text}</td><td className="mono">{row.actor}</td><td>{row.result}</td></tr>)}</tbody></table>
    </div>
  );
}

export function DirectView() {
  const section = sections.find(item => item.id === 'direct');
  return (
    <div className="page"><EmptyState title="Direct work arrives with control features." mark="⌁">
      {section?.hint}. The console is read-only in M1: it observes sessions but sends nothing to them. To connect an extension later, start the daemon and follow the pairing steps shown here.
    </EmptyState></div>
  );
}

export function SettingsView() {
  const state = useConsole();
  const prefs = usePrefs();
  const model = buildSettings(state);
  return (
    <div className="page settings">
      <h1>Settings and health</h1>
      <p className="note">{model.banner}</p>
      <div className="columns two">
        <div className="stack">
          <Panel title="Connection"><p className={model.connection.healthy ? 'ok' : 'warn-text'}>{model.connection.label}</p><p className="muted small">{model.connection.detail}</p></Panel>
          <Panel title="Daemon and sources">
            {model.sources.length === 0 ? <p className="muted">The daemon reports no health details yet.</p> : <dl className="kv">{model.sources.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
          </Panel>
          <Panel title="Data"><dl className="kv">{model.counts.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl></Panel>
        </div>
        <div className="stack">
          <Panel title="Appearance">
            <fieldset className="radios"><legend className="sr-only">Theme</legend>
              {model.themes.map(theme => <label key={theme.id}><input type="radio" name="theme" checked={prefs.theme === theme.id} onChange={() => { if (themeIds.includes(theme.id as ThemeId)) setPrefs({ theme: theme.id as ThemeId }); }} /> {theme.label}</label>)}
            </fieldset>
            <label className="check"><input type="checkbox" checked={prefs.reducedMotion} onChange={event => { setPrefs({ reducedMotion: event.target.checked }); }} /> Reduce motion</label>
          </Panel>
          <Panel title="Token"><p className="muted">{model.tokenNote}</p><button type="button" className="btn" onClick={() => { sessionStorage.clear(); window.location.reload(); }}>Forget token and reload</button></Panel>
          <Panel title="Palette"><div className="swatches">{model.palette.map(item => <span key={item.token} className="swatch" title={`${item.token} ${item.color}`}><i className={`sw-${item.token}`} />{item.token}</span>)}</div></Panel>
        </div>
      </div>
    </div>
  );
}
