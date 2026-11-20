/** The subset of OpenTUI's parsed key we depend on, so this stays testable without the renderer. */
export interface KeyInput { name: string; sequence: string; ctrl: boolean; meta: boolean; shift: boolean }

const named: Record<string, string> = {
  return: 'Enter', enter: 'Enter', linefeed: 'Enter', escape: 'Esc', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
};

/** Translates a terminal key into the neutral names of the shared keymap (`j`, `Enter`, `Ctrl+P`, `Shift+Tab`...). */
export function neutralKey(key: KeyInput): string {
  if (key.ctrl) return `Ctrl+${key.name.toUpperCase()}`;
  if (key.name === 'tab' && key.shift) return 'Shift+Tab';
  const mapped = named[key.name];
  if (mapped) return mapped;
  return key.sequence.length === 1 ? key.sequence : key.name;
}

/** The character a key types into a text field, if any. */
export function typedCharacter(key: KeyInput): string | undefined {
  if (key.ctrl || key.meta) return undefined;
  return key.name === 'space' ? ' ' : (key.sequence.length === 1 && key.sequence >= ' ' && key.sequence !== '\u007f' ? key.sequence : undefined);
}
