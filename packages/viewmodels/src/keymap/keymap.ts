import { sections, type SectionId } from './sections.ts';

/** A resolved key press. Both clients map it to behaviour; neither interprets raw keys itself. */
export type Command =
  | { type: 'goto'; section: SectionId }
  | { type: 'palette' } | { type: 'filter' } | { type: 'settings' } | { type: 'help' }
  | { type: 'prevFilter' } | { type: 'nextFilter' }
  | { type: 'move'; delta: number } | { type: 'top' } | { type: 'bottom' }
  | { type: 'open' } | { type: 'back' } | { type: 'nextPane' } | { type: 'prevPane' }
  | { type: 'copyId' } | { type: 'toggle' } | { type: 'scrubber' } | { type: 'toggleFollow' }
  | { type: 'zoom'; direction: 1 | -1 } | { type: 'pan'; direction: 1 | -1 }
  | { type: 'quit' }
  | { type: 'mutate'; action: 'answer' | 'steer' | 'followUp' | 'pause' | 'abort' | 'defer' };

export type KeyScope = 'global' | 'list' | 'transcript' | 'graph' | 'timeline';

export interface Binding { keys: readonly string[]; description: string; scope: KeyScope; command: Command; mutating?: boolean }

const sectionBindings: Binding[] = sections.map(section => ({
  keys: [section.key], description: `Go to ${section.label}`, scope: 'global', command: { type: 'goto', section: section.id },
}));

/**
 * The one keyboard map (docs/information-architecture.md section 6), shared by web and TUI. Key names use `Ctrl+P`,
 * `Shift+Tab`, a bare character for letters and symbols, and an uppercase letter for a shifted letter (`A`, `G`).
 */
export const bindings: readonly Binding[] = [
  ...sectionBindings,
  { keys: ['Ctrl+P', ':'], description: 'Command palette', scope: 'global', command: { type: 'palette' } },
  { keys: ['/'], description: 'Filter the list; in a transcript, search', scope: 'global', command: { type: 'filter' } },
  { keys: [','], description: 'Settings', scope: 'global', command: { type: 'settings' } },
  { keys: ['?'], description: 'Help', scope: 'global', command: { type: 'help' } },
  { keys: ['['], description: 'Previous saved filter', scope: 'list', command: { type: 'prevFilter' } },
  { keys: [']'], description: 'Next saved filter', scope: 'list', command: { type: 'nextFilter' } },
  { keys: ['j', 'ArrowDown'], description: 'Move down', scope: 'list', command: { type: 'move', delta: 1 } },
  { keys: ['k', 'ArrowUp'], description: 'Move up', scope: 'list', command: { type: 'move', delta: -1 } },
  { keys: ['g'], description: 'Top', scope: 'list', command: { type: 'top' } },
  { keys: ['G'], description: 'Bottom', scope: 'list', command: { type: 'bottom' } },
  { keys: ['Enter'], description: 'Open', scope: 'list', command: { type: 'open' } },
  { keys: ['Escape'], description: 'Close, cancel, back', scope: 'global', command: { type: 'back' } },
  { keys: ['Tab'], description: 'Next pane', scope: 'global', command: { type: 'nextPane' } },
  { keys: ['Shift+Tab'], description: 'Previous pane', scope: 'global', command: { type: 'prevPane' } },
  { keys: ['y'], description: 'Copy id', scope: 'list', command: { type: 'copyId' } },
  { keys: [' '], description: 'Select or collapse group', scope: 'list', command: { type: 'toggle' } },
  { keys: ['t'], description: 'Toggle time scrubber', scope: 'graph', command: { type: 'scrubber' } },
  { keys: ['f'], description: 'Toggle follow-tail in a transcript', scope: 'transcript', command: { type: 'toggleFollow' } },
  { keys: ['+', '='], description: 'Zoom in', scope: 'timeline', command: { type: 'zoom', direction: 1 } },
  { keys: ['-'], description: 'Zoom out', scope: 'timeline', command: { type: 'zoom', direction: -1 } },
  { keys: ['h', 'ArrowLeft'], description: 'Pan earlier', scope: 'timeline', command: { type: 'pan', direction: -1 } },
  { keys: ['l', 'ArrowRight'], description: 'Pan later', scope: 'timeline', command: { type: 'pan', direction: 1 } },
  { keys: ['Ctrl+C'], description: 'Quit the TUI (never aborts a session)', scope: 'global', command: { type: 'quit' } },
  { keys: ['a'], description: 'Answer (read-only in M1)', scope: 'list', command: { type: 'mutate', action: 'answer' }, mutating: true },
  { keys: ['s'], description: 'Steer (read-only in M1)', scope: 'list', command: { type: 'mutate', action: 'steer' }, mutating: true },
  { keys: ['p'], description: 'Pause (read-only in M1)', scope: 'list', command: { type: 'mutate', action: 'pause' }, mutating: true },
  { keys: ['A'], description: 'Abort, typed confirmation (read-only in M1)', scope: 'list', command: { type: 'mutate', action: 'abort' }, mutating: true },
  { keys: ['d'], description: 'Defer (read-only in M1)', scope: 'list', command: { type: 'mutate', action: 'defer' }, mutating: true },
];

export interface KeyInput { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }

/** Canonical key name for an input event; the same function runs in the browser and the terminal. */
export function keyName(input: KeyInput): string {
  if (input.ctrl) return `Ctrl+${input.key.toUpperCase()}`;
  if (input.shift && input.key === 'Tab') return 'Shift+Tab';
  return input.key;
}

const index = new Map<string, Binding>();
for (const binding of bindings) for (const key of binding.keys) index.set(key, binding);

/** Resolves a key press to a command, or null. Alt/Meta chords are never bound (left to the platform). */
export function resolveKey(input: KeyInput): Binding | null {
  if (input.alt || input.meta) return null;
  return index.get(keyName(input)) ?? null;
}

/** Bindings relevant to a context, for the footer hint bar and the help overlay. */
export function bindingsFor(...scopes: KeyScope[]): Binding[] {
  return bindings.filter(binding => scopes.includes(binding.scope) && !/^[1-9]$/.exec(binding.keys[0]));
}
