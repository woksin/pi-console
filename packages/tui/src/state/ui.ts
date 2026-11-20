import { resolve, type Action, type KeyContext } from '@pi-console/viewmodels';
import { zoom, pan, type TimeWindow } from '@pi-console/viewmodels';

export type Section = 'overview' | 'fleet' | 'requests' | 'questions' | 'messages' | 'timeline' | 'work';
export const sections: readonly Section[] = ['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work'];
export type Overlay = 'none' | 'palette' | 'filter' | 'help' | 'settings' | 'search';
export type SidePane = 'requests' | 'questions' | 'jobs' | 'resets';
export const sidePanes: readonly SidePane[] = ['requests', 'questions', 'jobs', 'resets'];

export interface UiState {
  section: Section;
  /** The open session, shown as a full-screen detail over the current section. */
  sessionId: string | null;
  overlay: Overlay;
  /** The text being typed in the palette, filter or transcript search. */
  input: string;
  paletteIndex: number;
  filter: string;
  cursor: Record<Section, number>;
  collapsed: readonly string[];
  /** Lines scrolled up from the live tail; 0 with `follow` is "following". */
  scroll: number;
  follow: boolean;
  search: string;
  pane: SidePane;
  messagesGraph: boolean;
  window: TimeWindow | null;
  scrub: boolean;
  scrubColumn: number;
  quit: boolean;
  notice: string;
}

export const initial: UiState = {
  section: 'overview', sessionId: null, overlay: 'none', input: '', paletteIndex: 0, filter: '',
  cursor: { overview: 0, fleet: 0, requests: 0, questions: 0, messages: 0, timeline: 0, work: 0 },
  collapsed: [], scroll: 0, follow: true, search: '', pane: 'requests', messagesGraph: false, window: null, scrub: false, scrubColumn: 0, quit: false, notice: '',
};

/** What the reducer needs to know about the rendered world; supplied by the view layer. */
export interface Bounds { length: number; page: number; fit: TimeWindow; width: number; rowAt: (index: number) => { sessionId: string | null; groupId: string | null }; transcriptLength: number }

export function contextOf(state: UiState): KeyContext {
  if (state.overlay === 'palette') return 'palette';
  if (state.overlay === 'filter' || state.overlay === 'search') return 'filter';
  if (state.overlay === 'help' || state.overlay === 'settings') return 'help';
  if (state.sessionId) return 'transcript';
  if (state.section === 'timeline') return 'timeline';
  if (state.section === 'messages' && state.messagesGraph) return 'graph';
  return 'list';
}

const clamp = (value: number, length: number) => Math.max(0, Math.min(Math.max(0, length - 1), value));
const withCursor = (state: UiState, index: number, bounds: Bounds): UiState => ({ ...state, cursor: { ...state.cursor, [state.section]: clamp(index, bounds.length) } });

function moveList(state: UiState, action: Action, bounds: Bounds): UiState {
  const at = state.cursor[state.section];
  const target: Partial<Record<Action, number>> = { 'move.up': at - 1, 'move.down': at + 1, 'move.top': 0, 'move.bottom': bounds.length - 1, 'page.up': at - bounds.page, 'page.down': at + bounds.page };
  return withCursor(state, target[action] ?? at, bounds);
}

function moveTranscript(state: UiState, action: Action, bounds: Bounds): UiState {
  const maximum = Math.max(0, bounds.transcriptLength - 1);
  const delta: Partial<Record<Action, number>> = { 'move.up': 1, 'move.down': -1, 'page.up': bounds.page, 'page.down': -bounds.page };
  let scroll = state.scroll;
  if (action === 'move.top') scroll = maximum;
  else if (action === 'move.bottom') scroll = 0;
  else scroll = Math.max(0, Math.min(maximum, scroll + (delta[action] ?? 0)));
  return { ...state, scroll, follow: scroll === 0 };
}

const goto = (state: UiState, section: Section): UiState => ({ ...state, section, sessionId: null, overlay: 'none', filter: '', scrub: false });

function open(state: UiState, bounds: Bounds): UiState {
  const row = bounds.rowAt(state.cursor[state.section]);
  if (!row.sessionId) return row.groupId ? toggleGroup(state, bounds) : state;
  const sessionId = row.sessionId;
  return { ...state, sessionId, scroll: 0, follow: true, search: '', pane: 'requests' };
}

function back(state: UiState): UiState {
  if (state.overlay !== 'none') return { ...state, overlay: 'none', input: '' };
  if (state.scrub) return { ...state, scrub: false };
  if (state.sessionId) return { ...state, sessionId: null, search: '' };
  return state.filter ? { ...state, filter: '' } : state;
}

function timeline(state: UiState, action: Action, bounds: Bounds): UiState {
  const window = state.window ?? bounds.fit;
  if (state.scrub && (action === 'time.left' || action === 'time.right')) {
    return { ...state, scrubColumn: Math.max(0, Math.min(bounds.width - 1, state.scrubColumn + (action === 'time.left' ? -1 : 1) * Math.max(1, Math.round(bounds.width / 40)))) };
  }
  if (action === 'time.left') return { ...state, window: pan(window, -1) };
  if (action === 'time.right') return { ...state, window: pan(window, 1) };
  if (action === 'time.zoomIn') return { ...state, window: zoom(window, 0.6) };
  if (action === 'time.zoomOut') return { ...state, window: zoom(window, 1 / 0.6) };
  return { ...state, scrub: !state.scrub, scrubColumn: state.scrub ? state.scrubColumn : Math.floor(bounds.width / 2) };
}

const sectionActions: Partial<Record<Action, Section>> = {
  'section.1': 'overview', 'section.2': 'fleet', 'section.3': 'requests', 'section.4': 'questions', 'section.5': 'messages', 'section.6': 'timeline', 'section.7': 'work',
};

function cyclePane(state: UiState, direction: number): UiState {
  const next = (sidePanes.indexOf(state.pane) + direction + sidePanes.length) % sidePanes.length;
  return { ...state, pane: sidePanes[next] };
}

/** Applies a resolved keymap action. Returns the same state object when nothing changed. */
export function reduce(state: UiState, action: Action, bounds: Bounds): UiState {
  const target = sectionActions[action];
  if (target) return goto(state, target);
  switch (action) {
    case 'quit': return { ...state, quit: true };
    case 'palette.open': return { ...state, overlay: 'palette', input: '', paletteIndex: 0 };
    case 'filter.open': return state.sessionId ? { ...state, overlay: 'search', input: state.search } : { ...state, overlay: 'filter', input: state.filter };
    case 'settings.open': return { ...state, overlay: 'settings' };
    case 'help.toggle': return { ...state, overlay: state.overlay === 'help' ? 'none' : 'help' };
    case 'back': return back(state);
    case 'open': return open(state, bounds);
    case 'follow.toggle': return { ...state, follow: !state.follow, scroll: state.follow ? state.scroll : 0 };
    case 'view.toggle': return { ...state, messagesGraph: !state.messagesGraph, cursor: { ...state.cursor, messages: 0 } };
    case 'group.toggle': return toggleGroup(state, bounds);
    case 'pane.next': return cyclePane(state, 1);
    case 'pane.previous': return cyclePane(state, -1);
    case 'time.scrub': case 'time.zoomIn': case 'time.zoomOut': case 'time.left': case 'time.right': return timeline(state, action, bounds);
    case 'move.up': case 'move.down': case 'move.top': case 'move.bottom': case 'page.up': case 'page.down':
      return state.sessionId ? moveTranscript(state, action, bounds) : moveList(state, action, bounds);
    default: return state;
  }
}

function toggleGroup(state: UiState, bounds: Bounds): UiState {
  const groupId = state.section === 'fleet' && !state.sessionId ? bounds.rowAt(state.cursor.fleet).groupId : null;
  if (!groupId) return state;
  const collapsed = state.collapsed.includes(groupId) ? state.collapsed.filter(id => id !== groupId) : [...state.collapsed, groupId];
  return { ...state, collapsed };
}

/** Resolves a neutral key in the current state, then reduces; text fields are handled by `typing`. */
export function handleKey(state: UiState, key: string, bounds: Bounds): UiState {
  const action = resolve(contextOf(state), key);
  return action ? reduce(state, action, bounds) : state;
}

/** Text entry for the palette, filter and transcript search. `commit` is true when Enter should apply the field. */
export function typing(state: UiState, key: string, character: string | undefined): UiState {
  if (key === 'Backspace') return { ...state, input: [...state.input].slice(0, -1).join(''), paletteIndex: 0 };
  if (character) return { ...state, input: state.input + character, paletteIndex: 0 };
  return state;
}

/** Enter in a text field for filter and search (the palette is handled by the app, it executes a target). */
export function commit(state: UiState): UiState {
  if (state.overlay === 'filter') return { ...state, overlay: 'none', filter: state.input, input: '', cursor: { ...state.cursor, [state.section]: 0 } };
  if (state.overlay === 'search') return { ...state, overlay: 'none', search: state.input, input: '', scroll: 0, follow: state.input === '' };
  return state;
}
