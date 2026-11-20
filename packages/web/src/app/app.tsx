import { useCallback, useEffect, useMemo, useState } from 'react';
import { hints, resolve, type Action, type PaletteItem } from '@pi-console/viewmodels';
import { dispatch } from './commands.ts';
import { clockNow, navigate, useConsole, useRoute } from './hooks.ts';
import { contextFor, isTyping, neutralKey } from './keys.ts';
import { Help, Palette } from './overlays.tsx';
import { sectionIds, sectionMeta, sessionHref, titleFor, hrefFor, sectionFor } from './routes.ts';
import { Banner, Hints, Sidebar, TopBar } from './shell.tsx';
import { applyTheme } from './theme.ts';
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

export function App() {
  const state = useConsole();
  const route = useRoute();
  const prefs = usePrefs();
  const [overlay, setOverlay] = useState<Overlay>(null);
  useEffect(() => { applyTheme(document.documentElement, prefs.theme, prefs.reducedMotion); }, [prefs.theme, prefs.reducedMotion]);
  useEffect(() => { document.title = `${titleFor(route.view)} · pi console`; }, [route.view]);

  const context = contextFor({ route, palette: overlay === 'palette', help: overlay === 'help' });
  const perform = useCallback((action: Action): boolean => {
    if (overlay === 'help') {
      const closes = action === 'back' || action === 'help.toggle';
      if (closes) setOverlay(null);
      return closes;
    }
    return handleGlobal(action, { overlay, setOverlay }) || dispatch(action) || goBack(action, route.view);
  }, [overlay, route.view]);
  const onKey = useCallback((event: KeyboardEvent): void => {
    const key = neutralKey(event);
    if (!key || overlay === 'palette' || (isTyping(event.target) && key !== 'Ctrl+P')) return;
    const action = resolve(context, key);
    if (action && perform(action)) event.preventDefault();
  }, [context, overlay, perform]);
  useEffect(() => { window.addEventListener('keydown', onKey); return () => { window.removeEventListener('keydown', onKey); }; }, [onKey]);

  const pick = (item: PaletteItem): void => {
    setOverlay(null);
    if (item.target.kind === 'session') navigate(sessionHref(item.target.sessionId));
    else if (!handleGlobal(item.target.action, { overlay: null, setOverlay })) { const { action } = item.target; window.setTimeout(() => { dispatch(action); }, 0); }
  };
  const attention = useMemo(() => state.needsYou.length, [state.needsYou]);
  const wall = useTick(1000);
  const now = clockNow(state, wall);
  return (
    <div className="app">
      <Sidebar active={sectionFor(route.view)} settings={route.view === 'settings'} attention={attention} questions={state.questions.filter(q => q.status === 'open').length} collapsed={prefs.sidebarCollapsed} onCollapse={() => { setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed }); }} />
      <div className="main">
        <TopBar title={route.view === 'session' ? 'Session' : titleFor(route.view)} hint={sectionFor(route.view) ? sectionMeta[sectionFor(route.view) ?? 'overview'].hint : ''} state={state} onPalette={() => { setOverlay('palette'); }} onHelp={() => { setOverlay('help'); }} />
        <Banner state={state} wall={wall} />
        <main className="content" id="content" tabIndex={-1}><View route={route} state={state} now={now} /></main>
        <Hints items={hints(context)} />
      </div>
      {overlay === 'palette' && <Palette sessions={state.sessions} onClose={() => { setOverlay(null); }} onPick={pick} />}
      {overlay === 'help' && <Help onClose={() => { setOverlay(null); }} />}
    </div>
  );
}

/** Esc in a session or settings goes back to where the user came from. */
function goBack(action: Action, view: string): boolean {
  if (action !== 'back' || (view !== 'session' && view !== 'settings')) return false;
  if (window.history.length > 1) window.history.back(); else navigate(hrefFor('fleet'));
  return true;
}
