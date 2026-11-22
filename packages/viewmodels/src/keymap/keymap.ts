/**
 * The one keyboard map (docs/information-architecture.md section 6), shared by the web and TUI clients. Clients translate
 * their native key events to the neutral key names below and then ask `resolve`; they never define bindings of their own.
 */
export const listContexts = ['overview', 'fleet', 'requests', 'questions', 'messages', 'work'] as const;
export type KeyContext = typeof listContexts[number] | 'global' | 'detail' | 'transcript' | 'timeline' | 'graph' | 'palette' | 'filter' | 'help' | 'memory';
export type KeyClient = 'web' | 'tui';

export type Action =
  | 'section.1' | 'section.2' | 'section.3' | 'section.4' | 'section.5' | 'section.6' | 'section.7'
  | 'palette.open' | 'filter.open' | 'settings.open' | 'help.toggle' | 'quit'
  | 'move.up' | 'move.down' | 'move.top' | 'move.bottom' | 'page.up' | 'page.down'
  | 'attention.retry' | 'open' | 'back' | 'pane.next' | 'pane.previous' | 'follow.toggle' | 'copy.id' | 'view.toggle'
  | 'time.scrub' | 'time.zoomIn' | 'time.zoomOut' | 'time.left' | 'time.right'
  | 'group.toggle' | 'filter.next' | 'filter.previous' | 'filter.origin' | 'filter.session'
  | 'memory.next' | 'memory.previous' | 'memory.confirm' | 'memory.reject'
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
  clients?: readonly KeyClient[];
  /** Contexts where the binding exists only in the TUI; the web client has no handler there, so it neither resolves nor lists it. */
  tuiOnlyContexts?: readonly KeyContext[];
}

const lists = [...listContexts, 'detail'] as const;
const sections = ([1, 2, 3, 4, 5, 6, 7] as const).map(n => ({
  keys: [String(n)], action: `section.${String(n)}` as Action,
  label: ['Overview', 'Fleet', 'Requests', 'Questions', 'Messages', 'Timeline', 'Work'][n - 1], contexts: ['global'] as const,
}));

export const bindings: readonly Binding[] = [
  ...sections.map(section => ({ ...section, label: `Go to ${section.label}` })),
  { keys: ['Ctrl+P', ':'], action: 'palette.open', label: 'Command palette', hint: ': palette', contexts: ['global'] },
  { keys: ['/'], action: 'filter.open', label: 'Filter list; in a transcript, search', hint: '/ filter', contexts: [...listContexts.filter(context => context !== 'overview'), 'transcript', 'detail'] },
  { keys: [','], action: 'settings.open', label: 'Settings', contexts: ['global'] },
  { keys: ['?'], action: 'help.toggle', label: 'Help', hint: '? help', contexts: ['global'] },
  { keys: ['Ctrl+C', 'q'], action: 'quit', label: 'Quit the TUI (never aborts a session)', contexts: ['global'], clients: ['tui'] },
  { keys: ['j', 'ArrowDown'], action: 'move.down', label: 'Move down', hint: 'j/k move', contexts: [...lists, 'transcript', 'timeline', 'graph', 'palette'], tuiOnlyContexts: ['graph'] },
  { keys: ['k', 'ArrowUp'], action: 'move.up', label: 'Move up', contexts: [...lists, 'transcript', 'timeline', 'graph', 'palette'], tuiOnlyContexts: ['graph'] },
  { keys: ['g', 'Home'], action: 'move.top', label: 'Top', contexts: [...lists, 'transcript'] },
  { keys: ['G', 'End'], action: 'move.bottom', label: 'Bottom', contexts: [...lists, 'transcript'] },
  { keys: ['PageUp'], action: 'page.up', label: 'Page up', contexts: [...lists, 'transcript'] },
  { keys: ['PageDown'], action: 'page.down', label: 'Page down', contexts: [...lists, 'transcript'] },
  { keys: ['r'], action: 'attention.retry', label: 'Retry needs you after a failed load', hint: 'r retry', contexts: ['overview'], clients: ['tui'] },
  { keys: ['Enter'], action: 'open', label: 'Open', hint: '⏎ open', contexts: [...listContexts, 'timeline', 'graph', 'palette', 'filter'], tuiOnlyContexts: ['timeline', 'graph'] },
  { keys: ['Esc'], action: 'back', label: 'Close, cancel, back', hint: 'esc back', contexts: [...lists, 'transcript', 'graph', 'timeline', 'palette', 'filter', 'help'] },
  { keys: ['Tab'], action: 'pane.next', label: 'Next pane', hint: 'tab pane', contexts: ['detail', 'transcript'], clients: ['tui'] },
  { keys: ['Shift+Tab'], action: 'pane.previous', label: 'Previous pane', contexts: ['detail', 'transcript'], clients: ['tui'] },
  { keys: ['f'], action: 'follow.toggle', label: 'Toggle follow-tail in a transcript', hint: 'f follow', contexts: ['transcript'] },
  { keys: ['y'], action: 'copy.id', label: 'Copy id', hint: 'y copy id', contexts: [...lists, 'transcript'] },
  { keys: ['v'], action: 'view.toggle', label: 'Toggle list and graph', hint: 'v graph', contexts: ['messages', 'graph'] },
  { keys: ['v'], action: 'view.toggle', label: 'Expand or collapse question detail', hint: 'v expand', contexts: ['questions'], clients: ['tui'] },
  { keys: ['t'], action: 'time.scrub', label: 'Toggle time scrubber', contexts: ['graph', 'timeline'], tuiOnlyContexts: ['timeline'] },
  { keys: ['+', '='], action: 'time.zoomIn', label: 'Zoom the timeline in', hint: '+/- zoom', contexts: ['timeline'] },
  { keys: ['-'], action: 'time.zoomOut', label: 'Zoom the timeline out', contexts: ['timeline'] },
  { keys: ['h', 'ArrowLeft'], action: 'time.left', label: 'Pan earlier', hint: 'h/l pan', contexts: ['timeline'] },
  { keys: ['l', 'ArrowRight'], action: 'time.right', label: 'Pan later', contexts: ['timeline'] },
  { keys: ['Space'], action: 'group.toggle', label: 'Select or collapse group', hint: 'space fold', contexts: ['fleet'] },
  { keys: [']'], action: 'filter.next', label: 'Next saved filter (Requests: state)', contexts: ['requests'] },
  { keys: ['['], action: 'filter.previous', label: 'Previous saved filter (Requests: state)', contexts: ['requests'] },
  { keys: ['o'], action: 'filter.origin', label: 'Next origin filter (Requests)', contexts: ['requests'] },
  { keys: ['S'], action: 'filter.session', label: 'Next session filter (Requests)', contexts: ['requests'] },
  { keys: [']'], action: 'memory.next', label: 'Next memory item', contexts: ['memory'], clients: ['tui'] },
  { keys: ['['], action: 'memory.previous', label: 'Previous memory item', contexts: ['memory'], clients: ['tui'] },
  { keys: ['c'], action: 'memory.confirm', label: 'Request confirmation in pi', contexts: ['memory'], clients: ['tui'] },
  { keys: ['x'], action: 'memory.reject', label: 'Request rejection in pi', contexts: ['memory'], clients: ['tui'] },
  { keys: ['a'], action: 'answer', label: 'Answer a question', contexts: lists, availableFrom: 'M4' },
  { keys: ['s'], action: 'steer', label: 'Steer (composer, mode steer)', contexts: lists, availableFrom: 'M4' },
  { keys: ['F'], action: 'followUp', label: 'Follow-up in composer', contexts: lists, availableFrom: 'M4' },
  { keys: ['p'], action: 'pause', label: 'Pause', contexts: lists, availableFrom: 'M4' },
  { keys: ['A'], action: 'abort', label: 'Abort (typed confirmation)', contexts: lists, availableFrom: 'M4' },
  { keys: ['d'], action: 'defer', label: 'Defer', contexts: lists, availableFrom: 'M4' },
];

/** Active (shipped in M1) bindings only. */
export const activeBindings: readonly Binding[] = bindings.filter(binding => !binding.availableFrom);

export interface KeymapGroup { title: string; bindings: readonly Binding[] }
const groupTitles = ['Navigate', 'Lists', 'Transcript', 'Memory', 'Timeline', 'Global'] as const;

function groupOf(binding: Binding): string {
  if (binding.action.startsWith('section.')) return 'Navigate';
  if (binding.action.startsWith('memory.')) return 'Memory';
  if (binding.action.startsWith('time.')) return 'Timeline';
  if (binding.action.startsWith('pane.') || binding.action === 'follow.toggle') return 'Transcript';
  return binding.contexts.includes('global') ? 'Global' : 'Lists';
}

/** Display groups only: no new bindings or changes to resolution. Client-only rows stay client-only. */
export function keymapGroups(client: KeyClient): KeymapGroup[] {
  const active = bindingsFor(client);
  return groupTitles.map(title => ({ title, bindings: active.filter(binding => groupOf(binding) === title) }));
}

const keyLabels: Readonly<Record<string, string>> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '⏎', PageUp: 'PgUp', PageDown: 'PgDn', 'Shift+Tab': '⇧Tab' };
export const keyLabel = (key: string): string => keyLabels[key] ?? key;

/** Resolves a neutral key name in a context; `global` bindings apply everywhere unless the context text-captures keys. */
export const bindingsFor = (client: KeyClient): readonly Binding[] => activeBindings
  .filter(binding => !binding.clients || binding.clients.includes(client))
  .flatMap(binding => (client === 'web' ? forWeb(binding) : [binding]));

function forWeb(binding: Binding): Binding[] {
  if (!binding.tuiOnlyContexts) return [binding];
  const contexts = binding.contexts.filter(context => !binding.tuiOnlyContexts?.includes(context));
  return contexts.length === 0 ? [] : [{ ...binding, contexts }];
}

export function resolve(context: KeyContext, key: string, client: KeyClient = 'tui'): Action | undefined {
  const active = bindingsFor(client);
  const capturing = context === 'palette' || context === 'filter';
  const match = active.find(binding => binding.keys.includes(key) && binding.contexts.includes(context));
  if (match) return match.action;
  if (capturing) return undefined;
  return active.find(binding => binding.keys.includes(key) && binding.contexts.includes('global'))?.action;
}

/** Footer hints for a context, in table order, `global` hints last. */
export function hints(context: KeyContext, client: KeyClient = 'tui'): string[] {
  const active = bindingsFor(client);
  const own = active.filter(binding => binding.hint && binding.contexts.includes(context));
  const global = context === 'palette' || context === 'filter' ? [] : active.filter(binding => binding.hint && binding.contexts.includes('global'));
  return [...own, ...global].map(binding => binding.hint ?? '').filter((hint, index, all) => all.indexOf(hint) === index);
}
