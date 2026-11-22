import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type EffectCallback, type ReactElement } from 'react';
import { FlashTracker, LookTracker, paletteItems, pulseViewModel, rememberPick, resolve, type Action, type PaletteInput, type WindowedCollection } from '@pi-console/viewmodels';
import { Column, Screen, Text, h, useClipboard, useKeys, useSize, useTerminalTitle, useTick } from './view/renderer.ts';
import type { Store } from './store/store.ts';
import { commit, contextOf, handleKey, initial, reduce, resizeUi, typing, type Bounds, type Section, type UiState } from './state/ui.ts';
import { terminalContentWidth } from './state/session-layout.ts';
import { emptyLayout, resumeTranscript, transcriptViewport } from './state/transcript-window.ts';
import { neutralKey, typedCharacter, type KeyInput } from './state/keys.ts';
import { Header, banner, footerLine, pulseLine, terminalTitle } from './shell/chrome.ts';
import { Help, Palette, Settings, helpViewport } from './shell/overlays.ts';
import { collectionToLoad, countsOf, historyError, memoryInput, retryHistory, type RequestMemoryAction } from './app-input.ts';
import { fit, t } from './view/parts.ts';
import type { Env, SectionView } from './views/common.ts';
import { overviewView } from './views/overview.ts';
import { fleetView } from './views/fleet.ts';
import { requestsView } from './views/requests/requests.ts';
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
  /** Backfills a session's transcript when it is opened; cleanup cancels the load on close or switch. */
  loadTranscript: (sessionId: string) => ReturnType<EffectCallback>;
  /** Fetches the session's read-only memory summary and items. */
  loadMemory: (sessionId: string) => void;
  watchMemory?: (sessionId: string) => () => void;
  requestMemoryAction?: RequestMemoryAction;
  /** Fetches the next older page of a list the snapshot only windowed; called when the cursor reaches the end of a list. */
  loadMore?: (collection: WindowedCollection) => void;
  retryNeedsYou?: () => void;
  onQuit: () => void;
  /** Spinner and pulse motion; off for reduced-motion and tests. */
  animate: boolean;
  initialState?: Partial<UiState>;
  /** The wall clock for relative ages; fixed by the media harness so pictures are reproducible. Defaults to `Date.now`. */
  clock?: () => number;
}

const boundsOf = (view: SectionView, height: number): Bounds => ({
  length: view.length, page: Math.max(1, height - 6), fit: view.time?.fit ?? { start: 0, span: 1 }, width: view.time?.width ?? 0, rowAt: view.rowAt, sessionIds: view.sessionIds, transcript: view.transcript ?? emptyLayout, viewport: transcriptViewport(height), detail: view.detail,
});

const isVerticalArrow = (name: string): boolean => name === 'ArrowDown' || name === 'ArrowUp';
const movePaletteIndex = (index: number, delta: number, setCount: number): number => Math.max(0, Math.min(Math.max(0, setCount - 1), index + delta));
const isTextOverlay = (overlay: UiState['overlay']): boolean => overlay === 'palette' || overlay === 'filter' || overlay === 'search';
const pasteInto = (state: UiState, text: string): UiState => isTextOverlay(state.overlay) ? typing(state, '', text) : state;
const sectionOrder: readonly Section[] = ['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work'];

/** Text entry for the palette, filter and search; returns the next state. Keys never reach the keymap while typing. */
function typeInto(state: UiState, key: KeyInput, setCount: number, bounds: Bounds): UiState {
  const name = neutralKey(key);
  if (name === 'Esc') return reduce(state, 'back', bounds);
  if (state.overlay === 'palette' && isVerticalArrow(name)) return { ...state, paletteIndex: movePaletteIndex(state.paletteIndex, name === 'ArrowDown' ? 1 : -1, setCount) };
  return typing(state, name, typedCharacter(key));
}

/** Render and input share the current durable layout even before the resize effect commits it. */
function useUiState(width: number, seed: AppProps['initialState']) {
  const [stored, setStored] = useState<UiState>(() => resizeUi({ ...initial, ...seed }, width));
  const ui = resizeUi(stored, width);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const apply = (next: UiState) => { uiRef.current = next; setStored(next); };
  useEffect(() => { setStored(current => resizeUi(current, width)); }, [width]);
  return { ui, uiRef, apply };
}

export function App(props: AppProps): ReactElement {
  const data = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  const size = useSize();
  const copy = useClipboard();
  const { ui, uiRef, apply } = useUiState(size.width, props.initialState);
  const [clock, setClock] = useState({ now: (props.clock ?? Date.now)(), phase: 0 });

  useTick(props.animate ? 6 : 1, () => { setClock(previous => ({ now: (props.clock ?? Date.now)(), phase: props.animate ? previous.phase + 1 : 0 })); });

  const failure = historyError(data, ui);
  const { showPulse, bodyHeight } = frameSize(data, size.height, failure);
  const pulse = useMemo(() => pulseViewModel({ sessions: data.sessions, needsYou: data.needsYou.length }), [data.sessions, data.needsYou.length]);
  const [trackers] = useState(() => ({ look: new LookTracker(), flash: new FlashTracker() }));
  const onOverview = ui.section === 'overview' && !ui.sessionId;
  useEffect(() => { if (!onOverview) trackers.look.leave(); }, [onOverview, trackers]);
  const env: Env = {
    data, ui, now: clock.now, width: terminalContentWidth(size.width), height: bodyHeight, phase: clock.phase, changes: { ...trackers, motion: props.animate },
    click: index => { apply(openAt(uiRef.current, index, boundsOf(viewRef.current, bodyHeight))); },
  };
  const view = (ui.sessionId ? sessionView : sectionViews[ui.section])(env);
  const viewRef = useRef(view);
  viewRef.current = view;
  const atEnd = ui.cursor[ui.section] >= view.length - 1;
  useEffect(() => { const collection = collectionToLoad(ui, atEnd); if (collection) props.loadMore?.(collection); }, [ui.section, ui.sessionId, atEnd, view.length]);
  useUiEffects(ui, props, uiRef, apply);
  useFocusJump(ui, uiRef, viewRef, apply);
  const dataRef = useRef(data);
  dataRef.current = data;
  const heightRef = useRef(bodyHeight);
  heightRef.current = bodyHeight;

  useKeys(key => {
    retryHistory({ ui: uiRef.current, data: dataRef.current, key: neutralKey(key), length: viewRef.current.length, loadMore: props.loadMore });
    const memory = memoryInput(uiRef.current, neutralKey(key), dataRef.current, size.width, props.requestMemoryAction);
    if (memory) { apply(memory); return; }
    const current = viewRef.current;
    const bounds = { ...boundsOf(current, heightRef.current), help: helpViewport(size).bounds };
    apply(nextState(uiRef.current, key, { palette: dataRef.current, view: current, bounds, copy, needsYouError: dataRef.current.needsYouError, retryNeedsYou: props.retryNeedsYou }));
  }, text => { apply(pasteInto(uiRef.current, text)); });

  useTerminalTitle(terminalTitle(ui, data));
  const connectionBanner = banner(data.connection, size.width);
  const input = { endpoint: props.endpoint, tokenSource: props.tokenSource, ...data.connection, now: clock.now,
    counts: countsOf(data) };
  const selectSection = (section: Section) => { apply(reduce(uiRef.current, `section.${String(sectionOrder.indexOf(section) + 1)}` as Action, boundsOf(viewRef.current, heightRef.current))); };

  return h(Screen, {},
    h(Header, { ui, width: size.width, attention: data.needsYou.length, connection: data.connection, select: selectSection }),
    ...(showPulse ? [h(Text, { line: pulseLine(pulse, size.width) })] : []),
    ...(connectionBanner ? [h(Text, { line: connectionBanner })] : []),
    h(HistoryError, { collection: failure, width: size.width }),
    h(Column, { grow: 1, paddingX: 1 }, view.render()),
    h(Text, { line: footerLine(ui, size.width) }),
    ...overlays(ui, data, input, size));
}

function retryAttention(ui: UiState, key: KeyInput, ctx: KeyContext): boolean {
  if (!ctx.needsYouError) return false;
  if (resolve(contextOf(ui), neutralKey(key), 'tui') !== 'attention.retry') return false;
  ctx.retryNeedsYou?.();
  return true;
}

function HistoryError({ collection, width }: { collection: WindowedCollection | undefined; width: number }): ReactElement | null {
  if (!collection) return null;
  return h(Text, { line: fit([t(` Could not load older ${collection}. `, 'amber'), t('r', 'cyan'), t(' retry', 'muted')], width, 'raised') });
}

function frameSize(data: ReturnType<Store['getSnapshot']>, height: number, failure: WindowedCollection | undefined): { showPulse: boolean; bodyHeight: number } {
  const showPulse = height >= 24 && data.sessions.length > 0;
  return { showPulse, bodyHeight: Math.max(4, height - 2 - Number(!data.connection.connected) - Number(showPulse) - Number(failure !== undefined)) };
}

interface Size { width: number; height: number }

function overlays(ui: UiState, data: ReturnType<Store['getSnapshot']>, input: Parameters<typeof Settings>[0]['input'], size: Size): ReactElement[] {
  if (ui.overlay === 'palette') return [h(Palette, { ui, data, width: size.width, height: size.height })];
  if (ui.overlay === 'help') return [h(Help, { width: size.width, height: size.height, scroll: ui.helpScroll })];
  if (ui.overlay === 'settings') return [h(Settings, { input, width: size.width, height: size.height })];
  return [];
}

function openAt(state: UiState, index: number, bounds: Bounds): UiState {
  return reduce({ ...state, cursor: { ...state.cursor, [state.section]: index } }, 'open', bounds);
}

type PaletteData = Pick<PaletteInput, 'sessions' | 'requests' | 'questions' | 'messages'>;
interface KeyContext { palette: PaletteData; view: SectionView; bounds: Bounds; copy: (text: string) => boolean; needsYouError: boolean; retryNeedsYou?: () => void }

/** Next state for a key: text entry while an input overlay is open, otherwise the keymap (`y` copies the id and keeps the state). */
function nextState(state: UiState, key: KeyInput, ctx: KeyContext): UiState {
  if (retryAttention(state, key, ctx)) return state;
  if (neutralKey(key) === 'Ctrl+C') return reduce(state, 'quit', ctx.bounds);
  if (isTextOverlay(state.overlay)) {
    if (neutralKey(key) === 'Enter') return state.overlay === 'palette' ? runPalette(state, ctx.palette, ctx.bounds) : commit(state);
    return typeInto(state, key, state.overlay === 'palette' ? paletteItems({ ...ctx.palette, query: state.input, recents: state.recents, client: 'tui' }).length : 0, ctx.bounds);
  }
  const name = neutralKey(key);
  if (name === 'y') return copyId(state, ctx.view, ctx.copy);
  return handleKey(state, name, ctx.bounds);
}

/** Executes the highlighted palette entry: an action goes through the same reducer as its key, a session opens its detail. */
function runPalette(state: UiState, data: PaletteData, bounds: Bounds): UiState {
  const items = paletteItems({ ...data, query: state.input, recents: state.recents, client: 'tui' });
  const item = items[Math.min(state.paletteIndex, items.length - 1)];
  const closed: UiState = { ...state, overlay: 'none', input: '', paletteIndex: 0, recents: item ? rememberPick(state.recents, item.id) : state.recents };
  if (!item) return closed;
  if (item.target.kind === 'session') return { ...closed, sessionId: item.target.sessionId, ...resumeTranscript, search: '', focusEntry: item.target.entryId ?? null, questionDetail: false, detailScroll: 0 };
  return reduce(closed, item.target.action, bounds);
}

function copyId(state: UiState, view: SectionView, copy: (text: string) => boolean): UiState {
  const id = state.sessionId ?? view.idAt(state.cursor[state.section]);
  if (!id) return state;
  return { ...state, notice: copy(id) ? `copied ${id}` : `id ${id} (clipboard unavailable)` };
}

/** Session backfill, quit notification and notice expiry. */
/** Scrolls an opened session to the entry a request pointed at, as soon as that entry is in the loaded transcript. */
function useFocusJump(ui: UiState, uiRef: { current: UiState }, viewRef: { current: SectionView }, apply: (next: UiState) => void): void {
  useEffect(() => {
    const anchor = ui.focusEntry ? viewRef.current.focus?.() : undefined;
    if (anchor) apply({ ...uiRef.current, focusEntry: null, follow: false, anchor });
  });
}

function useUiEffects(ui: UiState, props: AppProps, uiRef: { current: UiState }, apply: (next: UiState) => void): void {
  useEffect(() => { if (ui.sessionId) return props.loadTranscript(ui.sessionId); }, [ui.sessionId]);
  useEffect(() => {
    if (!ui.sessionId || ui.pane !== 'memory') return;
    if (props.watchMemory) return props.watchMemory(ui.sessionId);
    props.loadMemory(ui.sessionId);
  }, [ui.sessionId, ui.pane]);
  useEffect(() => { if (ui.quit) props.onQuit(); }, [ui.quit]);
  useEffect(() => {
    if (!ui.notice) return undefined;
    const timer = setTimeout(() => { apply({ ...uiRef.current, notice: '' }); }, 2500);
    return () => { clearTimeout(timer); };
  }, [ui.notice]);
}
