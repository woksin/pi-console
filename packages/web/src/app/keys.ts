import { resolve, type Action, type KeyContext } from '@pi-console/viewmodels';
import { sectionFor, type Route } from './routes.ts';

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

/** Focused controls own activation keys, not navigation or overlay shortcuts. */
export const nativeActivation = (key: string | null, target: EventTarget | null): boolean =>
  (key === 'Enter' || key === 'Space') && target instanceof Element && target.closest('a, button, input, textarea, select, summary, [role="button"], [role="link"]') !== null;

/** Session detail owns its existing bindings and falls back to its transcript for documented reader shortcuts. */
export function resolveWebKey(context: KeyContext, key: string): Action | undefined {
  return resolve(context, key, 'web') ?? (context === 'detail' ? resolve('transcript', key, 'web') : undefined);
}

export interface ContextInput { route: Route; palette: boolean; help: boolean }

/** The keymap context for the current screen; overlays capture keys before the view beneath them. */
export function contextFor({ route, palette, help }: ContextInput): KeyContext {
  if (palette) return 'palette';
  if (help) return 'help';
  if (route.view === 'session') return 'detail';
  if (route.view === 'timeline') return 'timeline';
  if (route.view === 'messages' && route.params.view === 'graph') return 'graph';
  return sectionFor(route.view) ?? 'global';
}
