import { useMemo, useState } from 'react';
import { bindingsFor, paletteScopes, paletteView, resolve, type Action, type MatchSegment, type PaletteInput, type PaletteItem } from '@pi-console/viewmodels';
import { neutralKey } from './keys.ts';
import { useModalFocus } from './modal-focus.ts';
import { Kbd } from '../ui/primitives.tsx';

interface PaletteProps { data: Pick<PaletteInput, 'sessions' | 'requests' | 'questions' | 'messages'>; recents: readonly string[]; onClose: () => void; onPick: (item: PaletteItem) => void }

type PaletteStep = { kind: 'move'; index: number } | { kind: 'close' } | { kind: 'open' };

/** Palette keys: j/k stay typeable text, Ctrl+N/Ctrl+K act as the arrows. */
function paletteAction(event: KeyboardEvent): { action: Action | undefined; key: string | null } {
  const key = neutralKey(event);
  const aliases: Record<string, string> = { 'Ctrl+N': 'ArrowDown', 'Ctrl+K': 'ArrowUp' };
  return { action: key === null ? undefined : resolve('palette', aliases[key] ?? key), key };
}

function paletteStep({ action, key }: ReturnType<typeof paletteAction>, active: number, count: number): PaletteStep | null {
  if (action === 'move.down' && key !== 'j') return { kind: 'move', index: Math.min(count - 1, active + 1) };
  if (action === 'move.up' && key !== 'k') return { kind: 'move', index: Math.max(0, active - 1) };
  if (action === 'back') return { kind: 'close' };
  return action === 'open' && count > 0 ? { kind: 'open' } : null;
}

function Highlighted({ segments }: { segments: readonly MatchSegment[] }) {
  return <>{segments.map((segment, at) => segment.hit ? <mark key={at}>{segment.text}</mark> : <span key={at}>{segment.text}</span>)}</>;
}

function PaletteRow({ item, active, onHover, onPick }: { item: PaletteItem; active: boolean; onHover: () => void; onPick: () => void }) {
  return (
    <li id={`pal-${item.id}`} role="option" aria-selected={active} className={active ? 'pal-row active' : 'pal-row'} onMouseEnter={onHover} onMouseDown={event => { event.preventDefault(); onPick(); }}>
      <span className="pal-glyph" style={{ '--tone': `var(--${item.tone})` } as React.CSSProperties} role="img" aria-label={item.status} title={item.status}>{item.glyph}</span>
      <span className="pal-label truncate"><Highlighted segments={item.segments} /></span>
      <span className="pal-detail truncate">{item.detail}</span>{item.key && <Kbd>{item.key}</Kbd>}
    </li>
  );
}

function PaletteFooter({ shown, total }: { shown: number; total: number }) {
  return (
    <footer className="pal-foot">
      {paletteScopes.map(scope => <span key={scope.prefix}><Kbd>{scope.prefix}</Kbd>{scope.label}</span>)}
      <span className="grow" /><span className="tnum">{shown} of {total}</span>
    </footer>
  );
}

/** Jump anywhere: typed groups and prefixes from the shared palette view model; the keymap drives selection in the `palette` context. */
export function Palette({ data, recents, onClose, onPick }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const dialog = useModalFocus();
  const view = useMemo(() => paletteView({ ...data, query, recents, client: 'web' }), [data, query, recents]);
  const { items } = view;
  const active = Math.min(index, Math.max(0, items.length - 1));
  const onKey = (event: React.KeyboardEvent): void => {
    const step = paletteStep(paletteAction(event.nativeEvent), active, items.length);
    if (step === null) return;
    event.preventDefault();
    if (step.kind === 'move') setIndex(step.index);
    else if (step.kind === 'close') onClose();
    else if (items[active]) onPick(items[active]);
  };
  const row = (item: PaletteItem) => { const position = items.indexOf(item); return <PaletteRow key={item.id} item={item} active={position === active} onHover={() => { setIndex(position); }} onPick={() => { onPick(item); }} />; };
  return (
    <div className="overlay" onMouseDown={event => { event.preventDefault(); onClose(); }}>
      <div ref={dialog} tabIndex={-1} className="dialog palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={event => { event.stopPropagation(); }}>
        <input value={query} placeholder="Jump to a session, lane, request, question, message or command…" spellCheck={false} autoComplete="off"
          role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={onKey} />
        <ul id="palette-list" role="listbox" aria-label={`Results: ${view.scope}`}>
          {view.sections.map(section => (
            <li key={section.title} role="presentation" className="pal-section">
              <div className="pal-heading" aria-hidden="true">{section.title}</div>
              <ul role="group" aria-label={section.title}>{section.items.map(row)}</ul>
            </li>
          ))}
          {items.length === 0 && <li className="pal-empty" role="presentation">No matches in {view.scope}. Try another word or prefix.</li>}
        </ul>
        <PaletteFooter shown={view.shown} total={view.total} />
      </div>
    </div>
  );
}

/** Help is generated from the one keymap, so it can never disagree with what the keys do. */
export function Help({ onClose }: { onClose: () => void }) {
  const dialog = useModalFocus();
  return (
    <div className="overlay" onMouseDown={event => { event.preventDefault(); onClose(); }}>
      <div ref={dialog} tabIndex={-1} className="dialog help" role="dialog" aria-modal="true" aria-label="Keyboard help" onMouseDown={event => { event.stopPropagation(); }}>
        <header className="help-head"><h2>Keyboard</h2><button type="button" className="btn ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button></header>
        <p className="muted">Read-only console: nothing here can change a session. Same keys as the terminal UI.</p>
        <dl className="help-list">
          {bindingsFor('web').map(binding => (
            <div key={binding.action}><dt>{binding.keys.map(key => <Kbd key={key}>{key}</Kbd>)}</dt><dd>{binding.label}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}
