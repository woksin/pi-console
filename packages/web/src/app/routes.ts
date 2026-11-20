export const sectionIds = ['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work'] as const;
export type SectionId = (typeof sectionIds)[number];
export type ViewId = SectionId | 'session' | 'settings';

export const sectionMeta: Record<SectionId, { label: string; hint: string; icon: string }> = {
  overview: { label: 'Overview', hint: 'What needs you now', icon: '◉' },
  fleet: { label: 'Fleet', hint: 'Sessions and lanes', icon: '▤' },
  requests: { label: 'Requests', hint: 'Requests and answers', icon: '⇄' },
  questions: { label: 'Questions', hint: 'Decisions waiting for you', icon: '?' },
  messages: { label: 'Messages', hint: 'AI-to-AI messages and graph', icon: '⌬' },
  timeline: { label: 'Timeline', hint: 'Everything on one time axis', icon: '▭' },
  work: { label: 'Work', hint: 'Jobs, phases and CI', icon: '⚙' },
};

/** Hash routes: `#/fleet`, `#/session/s2?entry=entry4`, `#/messages?view=graph`, `#/settings`. */
export interface Route { view: ViewId; id: string | null; params: Record<string, string> }

const isSection = (value: string): value is SectionId => (sectionIds as readonly string[]).includes(value);

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [first = '', second] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query));
  const id = second ? decodeURIComponent(second) : null;
  if (first === 'session' && id) return { view: 'session', id, params };
  if (first === 'settings') return { view: 'settings', id: null, params };
  return { view: isSection(first) ? first : 'overview', id, params };
}

export function hrefFor(view: ViewId, id?: string | null, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `#/${view}${id ? `/${encodeURIComponent(id)}` : ''}${query ? `?${query}` : ''}`;
}

export const sessionHref = (id: string, entryId?: string | null): string => hrefFor('session', id, entryId ? { entry: entryId } : {});

export const sectionFor = (view: ViewId): SectionId | null => (isSection(view) ? view : null);
export const titleFor = (view: ViewId): string => (view === 'session' ? 'Session' : view === 'settings' ? 'Settings' : sectionMeta[view].label);
