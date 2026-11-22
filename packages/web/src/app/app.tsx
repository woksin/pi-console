import { useEffect, useMemo, useState } from 'react';
import { hints, rememberPick, type PaletteItem } from '@pi-console/viewmodels';
import { clockNow, useConsole, useRoute } from './hooks.ts';
import { contextFor } from './keys.ts';
import { pickTarget, useShortcuts, type Overlay } from './shortcuts.ts';
import { Help, Palette } from './overlays.tsx';
import { sectionMeta, titleFor, sectionFor } from './routes.ts';
import { Banner, Hints, Sidebar, TopBar, staleData } from './shell.tsx';
import { applyTheme } from './theme.ts';
import { faviconHref, setFavicon } from './favicon.ts';
import { attentionPresentation, attentionTitle } from './attention.ts';
import { setPrefs, usePrefs } from './prefs.ts';
import { View } from './view.tsx';
import { useTick } from '../ui/hooks.ts';

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
    pickTarget(item, setOverlay);
  };
  const attention = useMemo(() => attentionPresentation(state), [state.connection, state.needsYou, state.needsYouLoaded, state.needsYouError, state.needsYouCached]);
  const place = route.view === 'session' ? state.sessions.find(session => session.id === route.id)?.name ?? titleFor(route.view) : titleFor(route.view);
  useEffect(() => { document.title = attentionTitle(attention, place); }, [attention, place]);
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
