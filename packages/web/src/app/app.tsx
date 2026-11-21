import { useEffect, useMemo, useState } from 'react';
import { consoleTitle, hints, rememberPick, resolve, type Action, type KeyContext, type PaletteItem } from '@pi-console/viewmodels';
import { dispatch } from './commands.ts';
import { clockNow, navigate, useConsole, useRoute } from './hooks.ts';
import { contextFor, isTyping, neutralKey } from './keys.ts';
import { Help, Palette } from './overlays.tsx';
import { parseRoute, sectionIds, sectionMeta, sessionHref, titleFor, hrefFor, sectionFor } from './routes.ts';
import { Banner, Hints, Sidebar, TopBar, staleData } from './shell.tsx';
import { applyTheme } from './theme.ts';
import { faviconHref, setFavicon } from './favicon.ts';
import { setPrefs, usePrefs } from './prefs.ts';
import { View } from './view.tsx';
import { useTick } from '../ui/hooks.ts';

type Overlay = 'palette' | 'help' | null;

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
  key === null || overlay === 'palette' || (isTyping(target) && key !== 'Ctrl+P');

/** Routes one resolved action: an open help dialog only closes; otherwise global, then the focused view, then back. */
function perform(action: Action, overlay: Overlay, setOverlay: (overlay: Overlay) => void): boolean {
  if (overlay !== 'help') return handleGlobal(action, { overlay, setOverlay }) || dispatch(action) || goBack(action);
  const closes = action === 'back' || action === 'help.toggle';
  if (closes) setOverlay(null);
  return closes;
}

function useShortcuts(context: KeyContext, overlay: Overlay, setOverlay: (overlay: Overlay) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const key = neutralKey(event);
      if (key === null || ignoresKey(key, overlay, event.target)) return;
      const action = resolve(context, key, 'web');
      if (action && perform(action, overlay, setOverlay)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [context, overlay, setOverlay]);
}

export function App() {
  const state = useConsole();
  const route = useRoute();
  const prefs = usePrefs();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [recents, setRecents] = useState<readonly string[]>([]);
  useEffect(() => { applyTheme(document.documentElement, prefs.theme, prefs.reducedMotion); }, [prefs.theme, prefs.reducedMotion]);

  const context = contextFor({ route, palette: overlay === 'palette', help: overlay === 'help' });
  useShortcuts(context, overlay, setOverlay);
  const pick = (item: PaletteItem): void => {
    setOverlay(null);
    setRecents(previous => rememberPick(previous, item.id));
    if (item.target.kind === 'session') navigate(sessionHref(item.target.sessionId, item.target.entryId));
    else if (!handleGlobal(item.target.action, { overlay: null, setOverlay })) { const { action } = item.target; window.setTimeout(() => { dispatch(action); }, 0); }
  };
  const attention = useMemo(() => state.needsYou.length, [state.needsYou]);
  const place = route.view === 'session' ? state.sessions.find(session => session.id === route.id)?.name ?? titleFor(route.view) : titleFor(route.view);
  useEffect(() => { document.title = consoleTitle({ needsYou: attention, place }); }, [attention, place]);
  useEffect(() => { setFavicon(faviconHref(attention)); }, [attention]);
  const wall = useTick(1000);
  const now = clockNow(state, wall);
  return (
    <div className="app" data-stale={staleData(state, wall)}>
      <Sidebar active={sectionFor(route.view)} settings={route.view === 'settings'} attention={attention} questions={state.questions.filter(q => q.status === 'open').length} collapsed={prefs.sidebarCollapsed} onCollapse={() => { setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed }); }} />
      <div className="main">
        <TopBar title={route.view === 'session' ? 'Session' : titleFor(route.view)} hint={sectionFor(route.view) ? sectionMeta[sectionFor(route.view) ?? 'overview'].hint : ''} state={state} wall={wall} session={route.view === 'session' ? state.sessions.find(session => session.id === route.id) : undefined} onPalette={() => { setOverlay('palette'); }} onHelp={() => { setOverlay('help'); }} />
        <Banner state={state} wall={wall} />
        <main className={`content${staleData(state, wall) ? ' stale' : ''}`} data-stale={staleData(state, wall)} id="content" tabIndex={-1}><View route={route} state={state} now={now} /></main>
        <Hints items={hints(context, 'web')} />
      </div>
      {overlay === 'palette' && <Palette data={state} recents={recents} onClose={() => { setOverlay(null); }} onPick={pick} />}
      {overlay === 'help' && <Help onClose={() => { setOverlay(null); }} />}
    </div>
  );
}

const backable: readonly string[] = ['session', 'settings'];

/** Esc in a session or settings goes back to where the user came from. */
/** Reads the live hash, not React state: a key pressed in the instant after a navigation must act on where the user really is. */
function goBack(action: Action): boolean {
  if (action !== 'back' || !backable.includes(parseRoute(window.location.hash).view)) return false;
  if (window.history.length > 1) window.history.back(); else navigate(hrefFor('fleet'));
  return true;
}
