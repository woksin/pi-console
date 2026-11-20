import { useEffect, useMemo, useRef, useState } from 'react';
import { activeBindings, paletteItems, resolve, type Action, type PaletteItem } from '@pi-console/viewmodels';
import type { Session } from '@pi-console/contract';
import { neutralKey } from './keys.ts';
import { Kbd } from '../ui/primitives.tsx';

interface PaletteProps { sessions: readonly Session[]; onClose: () => void; onPick: (item: PaletteItem) => void }

/** Command palette: `>` commands, `@` sessions; the shared keymap drives selection in the `palette` context. */
export function Palette({ sessions, onClose, onPick }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => paletteItems({ sessions, query }), [sessions, query]);
  useEffect(() => { input.current?.focus(); }, []);
  const active = Math.min(index, Math.max(0, items.length - 1));
  const onKey = (event: React.KeyboardEvent): void => {
    const key = neutralKey(event.nativeEvent);
    const action: Action | undefined = key ? resolve('palette', key === 'Ctrl+N' ? 'ArrowDown' : key === 'Ctrl+K' ? 'ArrowUp' : key) : undefined;
    if (action === 'move.down' && key !== 'j') setIndex(Math.min(items.length - 1, active + 1));
    else if (action === 'move.up' && key !== 'k') setIndex(Math.max(0, active - 1));
    else if (action === 'back') onClose();
    else if (action === 'open' && items[active]) onPick(items[active]);
    else return;
    event.preventDefault();
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={event => { event.stopPropagation(); }}>
        <input ref={input} value={query} placeholder="Type a command or session…  (> commands, @ sessions)" spellCheck={false} autoComplete="off"
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={onKey} />
        <ul id="palette-list" role="listbox">
          {items.map((item, position) => (
            <li key={item.id} id={`pal-${item.id}`} role="option" aria-selected={position === active} className={position === active ? 'active' : ''}
              onMouseEnter={() => { setIndex(position); }} onMouseDown={() => { onPick(item); }}>
              <span className="pal-group">{item.group}</span><span className="grow truncate">{item.label}</span>
              <span className="muted small truncate">{item.detail}</span>{item.key && <Kbd>{item.key}</Kbd>}
            </li>
          ))}
          {items.length === 0 && <li className="muted pal-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

/** Help is generated from the one keymap, so it can never disagree with what the keys do. */
export function Help({ onClose }: { onClose: () => void }) {
  const closer = useRef<HTMLButtonElement>(null);
  useEffect(() => { closer.current?.focus(); }, []);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog help" role="dialog" aria-modal="true" aria-label="Keyboard help" onMouseDown={event => { event.stopPropagation(); }}>
        <header className="help-head"><h2>Keyboard</h2><button ref={closer} type="button" className="btn ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button></header>
        <p className="muted">Read-only console: nothing here can change a session. Same keys as the terminal UI.</p>
        <dl className="help-list">
          {activeBindings.map(binding => (
            <div key={binding.action}><dt>{binding.keys.map(key => <Kbd key={key}>{key}</Kbd>)}</dt><dd>{binding.label}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}
