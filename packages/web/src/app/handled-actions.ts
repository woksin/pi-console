import type { Action, KeyContext } from '@pi-console/viewmodels';

const sectionActions = ['section.1', 'section.2', 'section.3', 'section.4', 'section.5', 'section.6', 'section.7'] as const;
/** `useListNav` (hooks.ts): movement, paging, open and copy over any keyboard-selectable list. */
const listNav: readonly Action[] = ['move.up', 'move.down', 'move.top', 'move.bottom', 'page.up', 'page.down', 'open', 'copy.id'];

/**
 * The actions each web view registers a handler for (`useActions`, `useListNav`, `handleGlobal`). The keymap spec checks that every
 * binding the shared keymap enables for the web client resolves to one of these, so help and the footer cannot list a dead key.
 */
export const webHandled: Readonly<Partial<Record<KeyContext, readonly Action[]>>> = {
  global: [...sectionActions, 'palette.open', 'settings.open', 'help.toggle'],
  overview: listNav,
  fleet: [...listNav, 'filter.open', 'group.toggle'],
  requests: [...listNav, 'filter.open', 'filter.next', 'filter.previous', 'filter.origin', 'filter.session'],
  questions: listNav,
  messages: [...listNav, 'view.toggle'],
  work: listNav,
  detail: ['move.up', 'move.down', 'move.top', 'move.bottom', 'page.up', 'page.down', 'back', 'filter.open', 'copy.id', 'follow.toggle'],
  timeline: ['move.up', 'move.down', 'time.zoomIn', 'time.zoomOut', 'time.left', 'time.right'],
  graph: ['view.toggle', 'time.scrub'],
  help: ['back', 'help.toggle'],
  // The palette handles its own keys inside the dialog (overlays.tsx).
  palette: ['move.up', 'move.down', 'open', 'back'],
};

/** `/` is bound on these lists by the keymap but not yet handled on the web; tracked in woksin/pi-console#128. */
export const knownMissing: Readonly<Partial<Record<KeyContext, readonly Action[]>>> = {
  overview: ['filter.open'], questions: ['filter.open'], messages: ['filter.open'], work: ['filter.open'],
};
