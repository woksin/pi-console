import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { paletteItems, type Action } from '@pi-console/viewmodels';
import { Column, Screen, Text, h, useClipboard, useKeys, useSize, useTick } from './view/renderer.ts';
import type { Store } from './store/store.ts';
import { commit, handleKey, initial, reduce, typing, type Bounds, type Section, type UiState } from './state/ui.ts';
import { neutralKey, typedCharacter, type KeyInput } from './state/keys.ts';
import { Header, banner, footerLine } from './shell/chrome.ts';
import { Help, Palette, Settings } from './shell/overlays.ts';
import type { Env, SectionView } from './views/common.ts';
import { overviewView } from './views/overview.ts';
import { fleetView } from './views/fleet.ts';
import { requestsView } from './views/requests.ts';
import { questionsView } from './views/questions.ts';
import { messagesView } from './views/messages.ts';
import { timelineView } from './views/timeline.ts';
import { workView } from './views/work.ts';
import { sessionView } from './views/session.ts';

const sectionViews: Record<Section, (env: Env) => SectionView> = {
  overview: overviewView, fleet: fleetView, requests: requestsView, questions: questionsView, messages: messagesView, timeline: timelineView, work: workView,
};

export interface AppProps {
  store: Store; endpoint: string; tokenSource: string;
  /** Backfills a session's transcript when it is opened. */
  loadTranscript: (sessionId: string) => void;
  onQuit: () => void;
  /** Spinner and pulse motion; off for reduced-motion and tests. */
  animate: boolean;
  initialState?: Partial<UiState>;
}

const boundsOf = (view: SectionView, height: number): Bounds => ({
  length: view.length, page: Math.max(1, height - 6), fit: view.time?.fit ?? { start: 0, span: 1 }, width: view.time?.width ?? 0, rowAt: view.rowAt, transcriptLength: view.length,
});

const noBounds: Bounds = { length: 0, page: 1, fit: { start: 0, span: 1 }, width: 0, rowAt: () => ({ sessionId: null, groupId: null }), transcriptLength: 0 };

/** Text entry for the palette, filter and search; returns the next state. Keys never reach the keymap while typing. */
function typeInto(state: UiState, key: KeyInput, setCount: number): UiState {
  const name = neutralKey(key);
  if (name === 'Esc') return reduce(state, 'back', noBounds);
  if (state.overlay === 'palette' && (name === 'ArrowDown' || name === 'ArrowUp')) {
    return { ...state, paletteIndex: Math.max(0, Math.min(Math.max(0, setCount - 1), state.paletteIndex + (name === 'ArrowDown' ? 1 : -1))) };
  }
  return typing(state, name, typedCharacter(key));
}

export function App(props: AppProps): ReactElement {
  const data = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  const size = useSize();
  const copy = useClipboard();
  const [ui, setUi] = useState<UiState>({ ...initial, ...props.initialState });
  const [clock, setClock] = useState({ now: Date.now(), phase: 0 });
  const uiRef = useRef(ui);
  const apply = (next: UiState) => { uiRef.current = next; setUi(next); };

  useTick(props.animate ? 6 : 1, () => { setClock(previous => ({ now: Date.now(), phase: props.animate ? previous.phase + 1 : 0 })); });
  useEffect(() => { if (ui.sessionId) props.loadTranscript(ui.sessionId); }, [ui.sessionId]);
  useEffect(() => { if (ui.quit) props.onQuit(); }, [ui.quit]);
  useEffect(() => {
    if (!ui.notice) return undefined;
    const timer = setTimeout(() => { apply({ ...uiRef.current, notice: '' }); }, 2500);
    return () => { clearTimeout(timer); };
  }, [ui.notice]);

  const showBanner = !data.connection.connected;
  const bodyHeight = Math.max(4, size.height - 2 - (showBanner ? 1 : 0));
  const env: Env = {
    data, ui, now: clock.now, width: size.width - 2, height: bodyHeight, phase: clock.phase,
    click: index => { const withCursor = { ...uiRef.current, cursor: { ...uiRef.current.cursor, [uiRef.current.section]: index } }; apply(reduce(withCursor, 'open', boundsOf(viewRef.current, bodyHeight))); },
  };
  const view = (ui.sessionId ? sessionView : sectionViews[ui.section])(env);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dataRef = useRef(data);
  dataRef.current = data;
  const heightRef = useRef(bodyHeight);
  heightRef.current = bodyHeight;

  useKeys(key => {
    const state = uiRef.current;
    const current = viewRef.current;
    if (state.overlay === 'palette' || state.overlay === 'filter' || state.overlay === 'search') {
      const name = neutralKey(key);
      if (name === 'Enter') { apply(state.overlay === 'palette' ? runPalette(state, dataRef.current.sessions, boundsOf(current, heightRef.current)) : commit(state)); return; }
      apply(typeInto(state, key, state.overlay === 'palette' ? paletteItems({ sessions: dataRef.current.sessions, query: state.input }).length : 0));
      return;
    }
    const name = neutralKey(key);
    const bounds = boundsOf(current, heightRef.current);
    if (name === 'y') { copyId(state, current, copy, apply); return; }
    apply(handleKey(state, name, bounds));
  });

  const connectionBanner = banner(data.connection, size.width);
  const input = { endpoint: props.endpoint, tokenSource: props.tokenSource, ...data.connection, now: clock.now,
    counts: { sessions: data.sessions.length, requests: data.requests.length, questions: data.questions.length, messages: data.messages.length, jobs: data.jobs.length, resets: data.resets.length, 'needs you': data.needsYou.length } };
  const selectSection = (section: Section) => { apply(reduce(uiRef.current, `section.${String(['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work'].indexOf(section) + 1)}` as Action, boundsOf(viewRef.current, heightRef.current))); };

  return h(Screen, {},
    h(Header, { ui, attention: data.needsYou.length, connection: data.connection, select: selectSection }),
    ...(connectionBanner ? [h(Text, { line: connectionBanner })] : []),
    h(Column, { grow: 1, paddingX: 1 }, view.render()),
    h(Text, { line: footerLine(ui, size.width) }),
    ...(ui.overlay === 'palette' ? [h(Palette, { ui, data, width: size.width, height: size.height })] : []),
    ...(ui.overlay === 'help' ? [h(Help, { width: size.width, height: size.height })] : []),
    ...(ui.overlay === 'settings' ? [h(Settings, { input, width: size.width, height: size.height })] : []));
}

/** Executes the highlighted palette entry: an action goes through the same reducer as its key, a session opens its detail. */
function runPalette(state: UiState, sessions: Parameters<typeof paletteItems>[0]['sessions'], bounds: Bounds): UiState {
  const items = paletteItems({ sessions, query: state.input });
  const item = items[Math.min(state.paletteIndex, items.length - 1)];
  const closed: UiState = { ...state, overlay: 'none', input: '', paletteIndex: 0 };
  if (!item) return closed;
  if (item.target.kind === 'session') return { ...closed, sessionId: item.target.sessionId, scroll: 0, follow: true, search: '' };
  return reduce(closed, item.target.action, bounds);
}

function copyId(state: UiState, view: SectionView, copy: (text: string) => boolean, apply: (next: UiState) => void): void {
  const id = state.sessionId ?? view.idAt(state.cursor[state.section]);
  if (!id) return;
  apply({ ...state, notice: copy(id) ? `copied ${id}` : `id ${id} (clipboard unavailable)` });
}
