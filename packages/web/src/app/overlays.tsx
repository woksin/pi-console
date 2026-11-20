import { bindings, fuzzyScore, sections, type ConsoleState } from '@pi-console/viewmodels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, navigate } from './hooks.ts';
import { hrefFor, sessionHref } from './routes.ts';
import { setPrefs, usePrefs } from './prefs.ts';
import { themeIds } from './theme.ts';
import { Kbd } from '../ui/primitives.tsx';

interface Action { id: string; label: string; hint: string; run: () => void }

function actionsFor(state: ConsoleState, prefs: ReturnType<typeof usePrefs>): Action[] {
  const go = sections.map(section => ({ id: `go-${section.id}`, label: `Go to ${section.label}`, hint: section.key, run: () => { navigate(hrefFor(section.id)); } }));
  const open = state.sessions.map(session => ({ id: `s-${session.id}`, label: `Open ${session.laneId} ${session.name}`, hint: session.id, run: () => { navigate(sessionHref(session.id)); } }));
  const preferences: Action[] = [
    { id: 'settings', label: 'Open settings', hint: ',', run: () => { navigate(hrefFor('settings')); } },
    { id: 'theme', label: `Switch theme (now ${prefs.theme})`, hint: 'theme', run: () => { setPrefs({ theme: themeIds[(themeIds.indexOf(prefs.theme) + 1) % themeIds.length] }); } },
    { id: 'motion', label: prefs.reducedMotion ? 'Enable motion' : 'Reduce motion', hint: 'motion', run: () => { setPrefs({ reducedMotion: !prefs.reducedMotion }); } },
    { id: 'link', label: 'Copy link to this view', hint: 'copy', run: () => { void copyText(window.location.href); } },
  ];
  return [...go, ...preferences, ...open];
}

export function Palette({ state, onClose }: { state: ConsoleState; onClose: () => void }) {
  const prefs = usePrefs();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const results = useMemo(() => actionsFor(state, prefs)
    .flatMap(action => { const score = fuzzyScore(query, action.label); return score === null ? [] : [{ action, score }]; })
    .sort((a, b) => a.score - b.score).slice(0, 12).map(item => item.action), [state, prefs, query]);
  const choose = (action: Action | undefined): void => { if (action) { onClose(); action.run(); } };
  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={event => { event.stopPropagation(); }}>
        <input ref={input} value={query} placeholder="Type a command or a session…" spellCheck={false} role="combobox" aria-expanded aria-controls="palette-list"
          onChange={event => { setQuery(event.target.value); setIndex(0); }}
          onKeyDown={event => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) { event.preventDefault(); setIndex(value => Math.min(results.length - 1, value + 1)); }
            else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) { event.preventDefault(); setIndex(value => Math.max(0, value - 1)); }
            else if (event.key === 'Enter') choose(results[index]);
          }} />
        <ul id="palette-list" role="listbox">
          {results.map((action, position) => (
            <li key={action.id} role="option" aria-selected={position === index} className={position === index ? 'active' : ''} onMouseEnter={() => { setIndex(position); }} onClick={() => { choose(action); }}>
              <span>{action.label}</span><span className="muted mono small">{action.hint}</span>
            </li>
          ))}
          {results.length === 0 && <li className="muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

export function Help({ onClose }: { onClose: () => void }) {
  const groups = ['global', 'list', 'transcript', 'graph', 'timeline'] as const;
  const names = { global: 'Everywhere', list: 'Lists', transcript: 'Transcript', graph: 'Graph', timeline: 'Timeline' };
  useEffect(() => {
    const close = (event: KeyboardEvent): void => { if (event.key === 'Escape' || event.key === '?') onClose(); };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); };
  }, [onClose]);
  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div className="dialog help" role="dialog" aria-modal="true" aria-label="Keyboard help" onClick={event => { event.stopPropagation(); }}>
        <h2>Keyboard</h2>
        <div className="help-grid">
          {groups.map(scope => (
            <section key={scope}><h3>{names[scope]}</h3>
              <dl>{bindings.filter(binding => binding.scope === scope && !/^[2-9]$/.test(binding.keys[0])).map(binding => (
                <div key={binding.description}><dt>{binding.keys.map(key => <Kbd key={key}>{key === ' ' ? 'Space' : key}</Kbd>)}</dt><dd>{binding.keys[0] === '1' ? 'Switch section (1 to 9)' : binding.description}</dd></div>
              ))}</dl>
            </section>
          ))}
        </div>
        <p className="muted small">Destructive keys are uppercase and always confirm. In this release the console is read-only: mutating keys explain themselves and do nothing.</p>
      </div>
    </div>
  );
}
