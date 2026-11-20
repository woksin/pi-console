import { isSection, type SectionId } from '@pi-console/viewmodels';

/** Hash routes: `#/fleet`, `#/session/s2?entry=entry4`, `#/requests/r1`, `#/settings`. */
export type Route =
  | { view: SectionId | 'settings'; id: string | null; params: Record<string, string> }
  | { view: 'session'; id: string; params: Record<string, string> };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first = '', second] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query));
  const id = second ? decodeURIComponent(second) : null;
  if (first === 'session' && id) return { view: 'session', id, params };
  if (first === 'settings') return { view: 'settings', id: null, params };
  return { view: isSection(first) ? first : 'overview', id, params };
}

export function hrefFor(view: string, id?: string | null, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `#/${view}${id ? `/${encodeURIComponent(id)}` : ''}${query ? `?${query}` : ''}`;
}

export const sessionHref = (id: string, entryId?: string | null): string => hrefFor('session', id, entryId ? { entry: entryId } : {});
