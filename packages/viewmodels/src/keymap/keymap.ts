/**
 * The one keyboard map (docs/information-architecture.md section 6), shared by the web and TUI clients. Clients translate
 * their native key events to the neutral key names below and then ask `resolve`; they never define bindings of their own.
 */
export type KeyContext = 'global' | 'list' | 'detail' | 'transcript' | 'timeline' | 'graph' | 'palette' | 'filter' | 'help';

export type Action =
  | 'section.1' | 'section.2' | 'section.3' | 'section.4' | 'section.5' | 'section.6' | 'section.7'
  | 'palette.open' | 'filter.open' | 'settings.open' | 'help.toggle' | 'quit'
  | 'move.up' | 'move.down' | 'move.top' | 'move.bottom' | 'page.up' | 'page.down'
  | 'open' | 'back' | 'pane.next' | 'pane.previous' | 'follow.toggle' | 'copy.id' | 'view.toggle'
  | 'time.scrub' | 'time.zoomIn' | 'time.zoomOut' | 'time.left' | 'time.right'
  | 'group.toggle' | 'filter.next' | 'filter.previous' | 'filter.origin' | 'filter.session'
  | 'answer' | 'steer' | 'followUp' | 'pause' | 'abort' | 'defer';

export interface Binding {
  /** Neutral key names: single characters as typed, plus Enter, Esc, Tab, Shift+Tab, Space, Ctrl+<letter>, ArrowUp... */
  keys: readonly string[];
  action: Action;
  label: string;
  /** Short footer text; omitted bindings are not hinted. */
  hint?: string;
  contexts: readonly KeyContext[];
  /** Bindings for intervention keys exist so the map is complete, but resolve nothing until their milestone ships. */
  availableFrom?: 'M4';
}

const lists = ['list', 'detail'] as const;
const sections = ([1, 2, 3, 4, 5, 6, 7] as const).map(n => ({
  keys: [String(n)], action: `section.${String(n)}` as Action,
  label: ['Overview', 'Fleet', 'Requests', 'Questions', 'Messages', 'Timeline', 'Work'][n - 1], contexts: ['global'] as const,
}));

export const bindings: readonly Binding[] = [
  ...sections.map(section => ({ ...section, label: `Go to ${section.label}` })),
  { keys: ['Ctrl+P', ':'], action: 'palette.open', label: 'Command palette', hint: ': palette', contexts: ['global'] },
  { keys: ['/'], action: 'filter.open', label: 'Filter list; in a transcript, search', hint: '/ filter', contexts: ['list', 'transcript', 'detail'] },
  { keys: [','], action: 'settings.open', label: 'Settings', contexts: ['global'] },
  { keys: ['?'], action: 'help.toggle', label: 'Help', hint: '? help', contexts: ['global'] },
  { keys: ['Ctrl+C', 'q'], action: 'quit', label: 'Quit the TUI (never aborts a session)', contexts: ['global'] },
  { keys: ['j', 'ArrowDown'], action: 'move.down', label: 'Move down', hint: 'j/k move', contexts: [...lists, 'transcript', 'timeline', 'graph', 'palette'] },
  { keys: ['k', 'ArrowUp'], action: 'move.up', label: 'Move up', contexts: [...lists, 'transcript', 'timeline', 'graph', 'palette'] },
  { keys: ['g', 'Home'], action: 'move.top', label: 'Top', contexts: [...lists, 'transcript'] },
  { keys: ['G', 'End'], action: 'move.bottom', label: 'Bottom', contexts: [...lists, 'transcript'] },
  { keys: ['PageUp'], action: 'page.up', label: 'Page up', contexts: [...lists, 'transcript'] },
  { keys: ['PageDown'], action: 'page.down', label: 'Page down', contexts: [...lists, 'transcript'] },
  { keys: ['Enter'], action: 'open', label: 'Open', hint: '⏎ open', contexts: ['list', 'timeline', 'graph', 'palette', 'filter'] },
  { keys: ['Esc'], action: 'back', label: 'Close, cancel, back', hint: 'esc back', contexts: ['list', 'detail', 'transcript', 'graph', 'timeline', 'palette', 'filter', 'help'] },
  { keys: ['Tab'], action: 'pane.next', label: 'Next pane', hint: 'tab pane', contexts: ['detail', 'transcript'] },
  { keys: ['Shift+Tab'], action: 'pane.previous', label: 'Previous pane', contexts: ['detail', 'transcript'] },
  { keys: ['f'], action: 'follow.toggle', label: 'Toggle follow-tail in a transcript', hint: 'f follow', contexts: ['transcript'] },
  { keys: ['y'], action: 'copy.id', label: 'Copy id', hint: 'y copy id', contexts: ['list', 'detail', 'transcript'] },
  { keys: ['v'], action: 'view.toggle', label: 'Toggle list and graph', hint: 'v graph', contexts: ['list', 'graph'] },
  { keys: ['t'], action: 'time.scrub', label: 'Toggle time scrubber (graph, timeline)', contexts: ['graph', 'timeline'] },
  { keys: ['+', '='], action: 'time.zoomIn', label: 'Zoom the timeline in', hint: '+/- zoom', contexts: ['timeline'] },
  { keys: ['-'], action: 'time.zoomOut', label: 'Zoom the timeline out', contexts: ['timeline'] },
  { keys: ['h', 'ArrowLeft'], action: 'time.left', label: 'Pan earlier', hint: 'h/l pan', contexts: ['timeline'] },
  { keys: ['l', 'ArrowRight'], action: 'time.right', label: 'Pan later', contexts: ['timeline'] },
  { keys: ['Space'], action: 'group.toggle', label: 'Select or collapse group', hint: 'space fold', contexts: ['list'] },
  { keys: [']'], action: 'filter.next', label: 'Next saved filter (Requests: state)', contexts: ['list'] },
  { keys: ['['], action: 'filter.previous', label: 'Previous saved filter (Requests: state)', contexts: ['list'] },
  { keys: ['o'], action: 'filter.origin', label: 'Next origin filter (Requests)', contexts: ['list'] },
  { keys: ['S'], action: 'filter.session', label: 'Next session filter (Requests)', contexts: ['list'] },
  { keys: ['a'], action: 'answer', label: 'Answer a question', contexts: ['list', 'detail'], availableFrom: 'M4' },
  { keys: ['s'], action: 'steer', label: 'Steer (composer, mode steer)', contexts: ['list', 'detail'], availableFrom: 'M4' },
  { keys: ['F'], action: 'followUp', label: 'Follow-up in composer', contexts: ['list', 'detail'], availableFrom: 'M4' },
  { keys: ['p'], action: 'pause', label: 'Pause', contexts: ['list', 'detail'], availableFrom: 'M4' },
  { keys: ['A'], action: 'abort', label: 'Abort (typed confirmation)', contexts: ['list', 'detail'], availableFrom: 'M4' },
  { keys: ['d'], action: 'defer', label: 'Defer', contexts: ['list', 'detail'], availableFrom: 'M4' },
];

/** Active (shipped in M1) bindings only. */
export const activeBindings: readonly Binding[] = bindings.filter(binding => !binding.availableFrom);

/** Resolves a neutral key name in a context; `global` bindings apply everywhere unless the context text-captures keys. */
export function resolve(context: KeyContext, key: string): Action | undefined {
  const capturing = context === 'palette' || context === 'filter';
  const match = activeBindings.find(binding => binding.keys.includes(key) && binding.contexts.includes(context));
  if (match) return match.action;
  if (capturing) return undefined;
  return activeBindings.find(binding => binding.keys.includes(key) && binding.contexts.includes('global'))?.action;
}

/** Footer hints for a context, in table order, `global` hints last. */
export function hints(context: KeyContext): string[] {
  const own = activeBindings.filter(binding => binding.hint && binding.contexts.includes(context));
  const global = context === 'palette' || context === 'filter' ? [] : activeBindings.filter(binding => binding.hint && binding.contexts.includes('global'));
  return [...own, ...global].map(binding => binding.hint ?? '').filter((hint, index, all) => all.indexOf(hint) === index);
}
