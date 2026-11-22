import { useEffect } from 'react';
import type { Action, KeyContext, PaletteItem } from '@pi-console/viewmodels';
import { dispatch } from './commands.ts';
import { navigate } from './hooks.ts';
import { isTyping, nativeActivation, neutralKey, resolveWebKey } from './keys.ts';
import { hrefFor, parseRoute, sectionIds, sessionHref } from './routes.ts';

export type Overlay = 'palette' | 'help' | null;

/** App-level actions: navigation and overlays. Everything else goes to the focused view through `dispatch`. */
function handleGlobal(action: Action, ctl: { overlay: Overlay; setOverlay: (overlay: Overlay) => void }): boolean {
  const section = /^section\.(\d)$/.exec(action);
  if (section) { navigate(hrefFor(sectionIds[Number(section[1]) - 1])); return true; }
  switch (action) {
    case 'palette.open': ctl.setOverlay('palette'); return true;
    case 'help.toggle': ctl.setOverlay(ctl.overlay === 'help' ? null : 'help'); return true;
    case 'settings.open': navigate(hrefFor('settings')); return true;
    case 'quit': return true; // The web console has nothing to quit; the key exists so the shared map stays whole.
    default: return false;
  }
}

const ignoresKey = (key: string | null, overlay: Overlay, target: EventTarget | null): boolean =>
  key === null || overlay === 'palette' || (isTyping(target) && key !== 'Ctrl+P') || nativeActivation(key, target);

/** Routes one resolved action: an open help dialog only closes; otherwise global, then the focused view, then back. */
function perform(action: Action, overlay: Overlay, setOverlay: (overlay: Overlay) => void): boolean {
  if (overlay !== 'help') return handleGlobal(action, { overlay, setOverlay }) || dispatch(action) || goBack(action);
  const closes = action === 'back' || action === 'help.toggle';
  if (closes) setOverlay(null);
  return closes;
}

export function useShortcuts(context: KeyContext, overlay: Overlay, setOverlay: (overlay: Overlay) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = neutralKey(event);
      if (key === null || ignoresKey(key, overlay, event.target)) return;
      const action = resolveWebKey(context, key);
      if (action && perform(action, overlay, setOverlay)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [context, overlay, setOverlay]);
}

export function pickTarget(item: PaletteItem, setOverlay: (overlay: Overlay) => void): void {
  if (item.target.kind === 'session') navigate(sessionHref(item.target.sessionId, item.target.entryId));
  else if (!handleGlobal(item.target.action, { overlay: null, setOverlay })) { const { action } = item.target; window.setTimeout(() => { dispatch(action); }, 0); }
}

const backable: readonly string[] = ['session', 'settings'];

/** Esc in a session or settings goes back to where the user came from. */
/** Reads the live hash, not React state: a key pressed in the instant after a navigation must act on where the user really is. */
export function goBack(action: Action): boolean {
  if (action !== 'back' || !backable.includes(parseRoute(window.location.hash).view)) return false;
  if (window.history.length > 1) window.history.back(); else navigate(hrefFor('fleet'));
  return true;
}
