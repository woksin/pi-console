import { cycleRequestFilter, requestFilterAction, resolve, type Action, type KeyContext, type RequestsFilter } from '@pi-console/viewmodels';
import { zoom, pan, type TimeWindow } from '@pi-console/viewmodels';
import { pauseTranscript, resumeTranscript, scrollTranscript, type TranscriptAnchor, type TranscriptLayout, type TranscriptMotion } from './transcript-window.ts';

export type Section = 'overview' | 'fleet' | 'requests' | 'questions' | 'messages' | 'timeline' | 'work';
export const sections: readonly Section[] = ['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work'];
export type Overlay = 'none' | 'palette' | 'filter' | 'help' | 'settings' | 'search';
export type SidePane = 'requests' | 'questions' | 'jobs' | 'resets' | 'memory';
export const sidePanes: readonly SidePane[] = ['requests', 'questions', 'jobs', 'resets', 'memory'];

export interface UiState {
  section: Section;
  /** The open session, shown as a full-screen detail over the current section. */
  sessionId: string | null;
  overlay: Overlay;
  helpScroll: number;
  /** The text being typed in the palette, filter or transcript search. */
  input: string;
  paletteIndex: number;
  /** Palette item ids picked before, newest first. */
  recents: readonly string[];
  filter: string;
  cursor: Record<Section, number>;
  collapsed: readonly string[];
  /** True while following the live tail. */
  follow: boolean;
  /** Stable position of a paused viewport (entry cursor + wrapped-line offset, see transcript-window.ts); `null` while following. */
  anchor: TranscriptAnchor | null;
  /** Requests list filters (the text filter is `filter`); cycled with `[` `]` `o` `S`. */
  requestFilter: Required<Omit<RequestsFilter, 'query'>>;
  /** Transcript entry to scroll to once the opened session's transcript has loaded (from a request's pointer); null otherwise. */
  focusEntry: string | null;
  search: string;
  questionDetail: boolean;
  detailScroll: number;
  pane: SidePane;
  memoryIndex: number;
  messagesGraph: boolean;
  window: TimeWindow | null;
  scrub: boolean;
  scrubColumn: number;
  quit: boolean;
  notice: string;
}

export const initial: UiState = {
  section: 'overview', sessionId: null, overlay: 'none', helpScroll: 0, input: '', paletteIndex: 0, recents: [], filter: '',
  cursor: { overview: 0, fleet: 0, requests: 0, questions: 0, messages: 0, timeline: 0, work: 0 },
  collapsed: [], follow: true, anchor: null, requestFilter: { state: 'all', origin: 'all', sessionId: null }, focusEntry: null, search: '', questionDetail: false, detailScroll: 0, pane: 'requests', memoryIndex: 0, messagesGraph: false, window: null, scrub: false, scrubColumn: 0, quit: false, notice: '',
};

/** What the reducer needs to know about the rendered world; supplied by the view layer. */
export interface Bounds { length: number; page: number; fit: TimeWindow; width: number; rowAt: (index: number) => { sessionId: string | null; groupId: string | null; entryId?: string | null }; sessionIds?: readonly string[]; transcript: TranscriptLayout; viewport: number; detail?: { max: number; page: number }; help?: { max: number; page: number } }

const contextRules: readonly (readonly [(state: UiState) => boolean, KeyContext])[] = [
  [state => state.overlay === 'palette', 'palette'],
  [state => state.overlay === 'filter' || state.overlay === 'search', 'filter'],
  [state => state.overlay === 'help' || state.overlay === 'settings', 'help'],
  [state => state.sessionId !== null, 'transcript'],
  [state => state.section === 'timeline', 'timeline'],
  [state => state.section === 'messages' && state.messagesGraph, 'graph'],
];

export function contextOf(state: UiState): KeyContext {
  return contextRules.find(([applies]) => applies(state))?.[1] ?? state.section;
}

const clamp = (value: number, length: number) => Math.max(0, Math.min(Math.max(0, length - 1), value));
const withCursor = (state: UiState, index: number, bounds: Bounds): UiState => ({ ...state, cursor: { ...state.cursor, [state.section]: clamp(index, bounds.length) } });

function moveList(state: UiState, action: Action, bounds: Bounds): UiState {
  const at = state.cursor[state.section];
  const target: Partial<Record<Action, number>> = { 'move.up': at - 1, 'move.down': at + 1, 'move.top': 0, 'move.bottom': bounds.length - 1, 'page.up': at - bounds.page, 'page.down': at + bounds.page };
  return withCursor(state, target[action] ?? at, bounds);
}

const transcriptMotions: Partial<Record<Action, (bounds: Bounds) => TranscriptMotion>> = {
  'move.up': () => -1, 'move.down': () => 1, 'page.up': bounds => -bounds.page, 'page.down': bounds => bounds.page, 'move.top': () => 'top', 'move.bottom': () => 'bottom',
};

function moveTranscript(state: UiState, action: Action, bounds: Bounds): UiState {
  const motion = transcriptMotions[action];
  return motion ? { ...state, focusEntry: null, ...scrollTranscript(bounds.transcript, state, bounds.viewport, motion(bounds)) } : state;
}

const goto = (state: UiState, section: Section): UiState => ({ ...state, section, sessionId: null, focusEntry: null, overlay: 'none', filter: '', scrub: false, questionDetail: false, detailScroll: 0 });

const opensQuestionDetail = (state: UiState, bounds: Bounds): boolean => state.section === 'questions' && bounds.detail !== undefined && bounds.length > 0;

function open(state: UiState, bounds: Bounds): UiState {
  if (opensQuestionDetail(state, bounds)) return { ...state, questionDetail: true, detailScroll: 0 };
  const row = bounds.rowAt(state.cursor[state.section]);
  if (!row.sessionId) return row.groupId ? toggleGroup(state, bounds) : state;
  const sessionId = row.sessionId;
  return { ...state, sessionId, ...resumeTranscript, search: '', pane: 'requests', focusEntry: row.entryId ?? null, questionDetail: false, detailScroll: 0 };
}

function back(state: UiState): UiState {
  if (state.overlay !== 'none') return { ...state, overlay: 'none', input: '' };
  if (state.questionDetail) return { ...state, questionDetail: false, detailScroll: 0 };
  if (state.scrub) return { ...state, scrub: false };
  if (state.sessionId) return { ...state, sessionId: null, search: '', focusEntry: null };
  return state.filter ? { ...state, filter: '' } : state;
}

const windowMoves: Partial<Record<Action, (window: TimeWindow) => TimeWindow>> = {
  'time.left': window => pan(window, -1),
  'time.right': window => pan(window, 1),
  'time.zoomIn': window => zoom(window, 0.6),
  'time.zoomOut': window => zoom(window, 1 / 0.6),
};

function scrubStep(state: UiState, action: Action, bounds: Bounds): UiState {
  const step = (action === 'time.left' ? -1 : 1) * Math.max(1, Math.round(bounds.width / 40));
  return { ...state, scrubColumn: Math.max(0, Math.min(bounds.width - 1, state.scrubColumn + step)) };
}

function timeline(state: UiState, action: Action, bounds: Bounds): UiState {
  if (state.scrub && (action === 'time.left' || action === 'time.right')) return scrubStep(state, action, bounds);
  const move = windowMoves[action];
  if (move) return { ...state, window: move(state.window ?? bounds.fit) };
  return { ...state, scrub: !state.scrub, scrubColumn: state.scrub ? state.scrubColumn : Math.floor(bounds.width / 2) };
}

const sectionActions: Partial<Record<Action, Section>> = {
  'section.1': 'overview', 'section.2': 'fleet', 'section.3': 'requests', 'section.4': 'questions', 'section.5': 'messages', 'section.6': 'timeline', 'section.7': 'work',
};

function cyclePane(state: UiState, direction: number): UiState {
  const next = (sidePanes.indexOf(state.pane) + direction + sidePanes.length) % sidePanes.length;
  return { ...state, pane: sidePanes[next] };
}

type Handler = (state: UiState, bounds: Bounds, action: Action) => UiState;

const onRequestsList = (state: UiState): boolean => state.section === 'requests' && !state.sessionId;

/** `[` `]` `o` `S` on the Requests list; the same shared actions the web console uses. */
function requestFilters(state: UiState, bounds: Bounds, action: Action): UiState {
  const cycle = requestFilterAction(action);
  if (!cycle || !onRequestsList(state)) return state;
  const next = cycleRequestFilter({ ...state.requestFilter, query: '' }, cycle.axis, bounds.sessionIds ?? [], cycle.step);
  return { ...state, requestFilter: { state: next.state, origin: next.origin, sessionId: next.sessionId }, cursor: { ...state.cursor, requests: 0 } };
}

const moveHandler: Handler = (state, bounds, action) => (state.sessionId ? moveTranscript(state, action, bounds) : moveList(state, action, bounds));

const handlers: Partial<Record<Action, Handler>> = {
  'quit': state => ({ ...state, quit: true }),
  'palette.open': state => ({ ...state, overlay: 'palette', input: '', paletteIndex: 0 }),
  'filter.open': state => (state.sessionId ? { ...state, overlay: 'search', input: state.search } : { ...state, overlay: 'filter', input: state.filter }),
  'settings.open': state => ({ ...state, overlay: 'settings' }),
  'help.toggle': state => ({ ...state, overlay: state.overlay === 'help' ? 'none' : 'help', helpScroll: 0 }),
  'back': state => back(state),
  'open': (state, bounds) => open(state, bounds),
  'filter.next': requestFilters, 'filter.previous': requestFilters, 'filter.origin': requestFilters, 'filter.session': requestFilters,
  'follow.toggle': (state, bounds) => ({ ...state, focusEntry: null, ...(state.follow ? pauseTranscript(bounds.transcript, state, bounds.viewport) : resumeTranscript) }),
  'view.toggle': state => ({ ...state, messagesGraph: !state.messagesGraph, cursor: { ...state.cursor, messages: 0 } }),
  'group.toggle': (state, bounds) => toggleGroup(state, bounds),
  'pane.next': state => cyclePane(state, 1),
  'pane.previous': state => cyclePane(state, -1),
  'time.scrub': (state, bounds, action) => timeline(state, action, bounds),
  'time.zoomIn': (state, bounds, action) => timeline(state, action, bounds),
  'time.zoomOut': (state, bounds, action) => timeline(state, action, bounds),
  'time.left': (state, bounds, action) => timeline(state, action, bounds),
  'time.right': (state, bounds, action) => timeline(state, action, bounds),
  'move.up': moveHandler, 'move.down': moveHandler, 'move.top': moveHandler, 'move.bottom': moveHandler, 'page.up': moveHandler, 'page.down': moveHandler,
};

function detailPosition(position: number, action: Action, bounds: Bounds['detail']): number | undefined {
  const page = bounds?.page ?? 1, max = bounds?.max ?? 0;
  const positions: Partial<Record<Action, number>> = { 'move.up': position - 1, 'move.down': position + 1, 'page.up': position - page, 'page.down': position + page, 'move.top': 0, 'move.bottom': max };
  const next = positions[action];
  return next === undefined ? undefined : Math.max(0, Math.min(max, next));
}

function scrollDetail(state: UiState, action: Action, bounds: Bounds): UiState | undefined {
  if (state.overlay === 'help') {
    const position = detailPosition(state.helpScroll, action, bounds.help);
    return position === undefined ? undefined : { ...state, helpScroll: position };
  }
  if (!state.questionDetail || state.overlay !== 'none') return undefined;
  const position = detailPosition(state.detailScroll, action, bounds.detail);
  return position === undefined ? undefined : { ...state, detailScroll: position };
}

/** Applies a resolved keymap action. Returns the same state object when nothing changed. */
export function reduce(state: UiState, action: Action, bounds: Bounds): UiState {
  const scrolled = scrollDetail(state, action, bounds);
  if (scrolled) return scrolled;
  const target = sectionActions[action];
  if (target) return goto(state, target);
  return handlers[action]?.(state, bounds, action) ?? state;
}

function toggleGroup(state: UiState, bounds: Bounds): UiState {
  const groupId = state.section === 'fleet' && !state.sessionId ? bounds.rowAt(state.cursor.fleet).groupId : null;
  if (!groupId) return state;
  const collapsed = state.collapsed.includes(groupId) ? state.collapsed.filter(id => id !== groupId) : [...state.collapsed, groupId];
  return { ...state, collapsed };
}

/** Resolves a neutral key in the current state, then reduces; text fields are handled by `typing`. */
const helpKeys: Record<string, Action> = { ArrowUp: 'move.up', k: 'move.up', ArrowDown: 'move.down', j: 'move.down', PageUp: 'page.up', PageDown: 'page.down', Home: 'move.top', g: 'move.top', End: 'move.bottom', G: 'move.bottom' };

export function handleKey(state: UiState, key: string, bounds: Bounds): UiState {
  const action = state.overlay === 'help' ? helpKeys[key] ?? resolve('help', key) : resolve(contextOf(state), key);
  return action ? reduce(state, action, bounds) : state;
}

/** Preview the draft without changing the committed filter; Escape discards the draft. */
export const listFilter = (state: UiState): string => state.overlay === 'filter' ? state.input : state.filter;

/** Text entry for the palette, filter and transcript search. */
export function typing(state: UiState, key: string, character: string | undefined): UiState {
  if (key !== 'Backspace' && !character) return state;
  const input = key === 'Backspace' ? [...state.input].slice(0, -1).join('') : state.input + (character ?? '');
  const cursor = state.overlay === 'filter' ? { ...state.cursor, [state.section]: 0 } : state.cursor;
  return { ...state, input, cursor, paletteIndex: 0 };
}

/** Enter in a text field for filter and search (the palette is handled by the app, it executes a target). */
export function commit(state: UiState): UiState {
  if (state.overlay === 'filter') return { ...state, overlay: 'none', filter: state.input, input: '', cursor: { ...state.cursor, [state.section]: 0 } };
  if (state.overlay === 'search') return { ...state, overlay: 'none', search: state.input, input: '', follow: state.input === '', anchor: null };
  return state;
}
