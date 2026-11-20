import { resolveKey } from '@pi-console/viewmodels';
import { useCallback, useEffect, useState } from 'react';
import { dispatch, useCommands } from './commands.ts';
import { navigate, useConsole, useRoute } from './hooks.ts';
import { hrefFor } from './routes.ts';
import { usePrefs, setPrefs } from './prefs.ts';
import { applyTheme } from './theme.ts';
import { Banner, ConnectionPill, KeyHints, Sidebar } from './shell.tsx';
import { Help, Palette } from './overlays.tsx';
import { OverviewView } from '../views/overview.tsx';
import { FleetView } from '../views/fleet.tsx';
import { SessionView } from '../views/session.tsx';
import { RequestsView } from '../views/requests.tsx';
import { QuestionsView } from '../views/questions.tsx';
import { MessagesView } from '../views/messages.tsx';
import { TimelineView } from '../views/timeline.tsx';
import { ActivityView, DirectView, SettingsView, WorkView } from '../views/simple.tsx';
import { sections, type SectionId } from '@pi-console/viewmodels';

const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
const pressable = (target: EventTarget | null): boolean => target instanceof HTMLElement && ['BUTTON', 'A', 'SUMMARY'].includes(target.tagName);

/** One window-level key handler: the shared keymap resolves the key, views and overlays consume the command. */
function useKeyboard(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const binding = resolveKey({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey });
      if (!binding) return;
      const type = binding.command.type;
      if (type === 'nextPane' || type === 'prevPane') return;
      if (typing(event.target) && type !== 'palette') return;
      if (pressable(event.target) && (type === 'toggle' || type === 'open')) return;
      if (dispatch(binding.command)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);
}

function Content({ route }: { route: ReturnType<typeof useRoute> }) {
  switch (route.view) {
    case 'overview': return <OverviewView />;
    case 'fleet': return <FleetView />;
    case 'session': return <SessionView sessionId={route.id} entry={route.params.entry ?? null} />;
    case 'requests': return <RequestsView selectedId={route.id} />;
    case 'questions': return <QuestionsView selectedId={route.id} />;
    case 'messages': return <MessagesView />;
    case 'timeline': return <TimelineView />;
    case 'work': return <WorkView />;
    case 'direct': return <DirectView />;
    case 'activity': return <ActivityView />;
    case 'settings': return <SettingsView />;
  }
}

const titleFor = (view: string): string => sections.find(section => section.id === view)?.label ?? (view === 'session' ? 'Session' : 'Settings');
const scopesFor = (view: string): ('global' | 'list' | 'transcript' | 'graph' | 'timeline')[] => ({
  session: ['global', 'transcript'], messages: ['global', 'graph', 'list'], timeline: ['global', 'timeline', 'list'],
} as const)[view as 'session' | 'messages' | 'timeline'] as never ?? ['global', 'list'];

export function App() {
  const state = useConsole();
  const route = useRoute();
  const prefs = usePrefs();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  useKeyboard();
  useEffect(() => { applyTheme(document.documentElement, prefs.theme, prefs.reducedMotion); }, [prefs.theme, prefs.reducedMotion]);
  useEffect(() => { document.title = `${titleFor(route.view)} · pi console`; }, [route.view]);
  const closePalette = useCallback(() => { setPalette(false); }, []);
  const closeHelp = useCallback(() => { setHelp(false); }, []);
  useCommands(command => {
    switch (command.type) {
      case 'goto': navigate(hrefFor(command.section satisfies SectionId)); return true;
      case 'palette': setPalette(value => !value); return true;
      case 'settings': navigate(hrefFor('settings')); return true;
      case 'help': setHelp(true); return true;
      case 'back': if (route.view === 'session') { navigate(hrefFor('fleet')); return true; } return false;
      case 'mutate': return true;
      default: return false;
    }
  });
  return (
    <div className="app">
      <Sidebar active={route.view} collapsed={prefs.sidebarCollapsed} onToggle={() => { setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed }); }} />
      <div className="main">
        <header className="topbar">
          <h1 className="crumb">{titleFor(route.view)}</h1>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={() => { setPalette(true); }}>Search or run a command <kbd className="kbd">Ctrl P</kbd></button>
          <ConnectionPill state={state} />
        </header>
        <Banner state={state} />
        <main className="content" id="content" tabIndex={-1}><Content route={route} /></main>
        <KeyHints scopes={scopesFor(route.view)} />
      </div>
      {palette && <Palette state={state} onClose={closePalette} />}
      {help && <Help onClose={closeHelp} />}
    </div>
  );
}
