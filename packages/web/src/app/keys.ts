import type { KeyContext } from '@pi-console/viewmodels';
import type { Route } from './routes.ts';

const named: Record<string, string> = { ' ': 'Space', Escape: 'Esc' };

/** Translates a DOM key event into the neutral key names of the shared keymap (`Ctrl+P`, `Shift+Tab`, `Esc`, `j`...). */
export function neutralKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (event.altKey) return null;
  const base = named[event.key] ?? event.key;
  if (event.ctrlKey || event.metaKey) return base.length === 1 ? `Ctrl+${base.toUpperCase()}` : null;
  if (event.shiftKey && base === 'Tab') return 'Shift+Tab';
  return base;
}

export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export interface ContextInput { route: Route; palette: boolean; help: boolean }

/** The keymap context for the current screen; overlays capture keys before the view beneath them. */
export function contextFor({ route, palette, help }: ContextInput): KeyContext {
  if (palette) return 'palette';
  if (help) return 'help';
  if (route.view === 'session') return 'detail';
  if (route.view === 'timeline') return 'timeline';
  if (route.view === 'messages' && route.params.view === 'graph') return 'graph';
  return 'list';
}
