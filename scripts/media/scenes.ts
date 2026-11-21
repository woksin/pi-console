// The shot list: the single source for what `npm run media` produces. The README, docs/media/README.md and the
// orphan/budget checks all read this, so a picture cannot be added, renamed or dropped in only one place.

export interface Shot {
  id: string;
  /** File name under docs/media/. */
  file: string;
  kind: 'still' | 'gif' | 'hero';
  client: 'web' | 'tui' | 'both';
  /** Output width in CSS pixels (stills are shot at 2x and scaled down to this). */
  width: number;
  theme: 'dark' | 'light';
  /** What the picture shows, for docs/media/README.md. */
  what: string;
}

/** Midnight is the dark default; dawn is the light theme. */
export const stillWidth = 1280;
export const gifWebWidth = 960;
export const gifTuiWidth = 880;
export const gifFps = 12;

/** A fixed wall clock for every capture; the fixture itself is dated 2026-11-20. */
export const fixedNow = '2026-11-20T12:00:00Z';

export const budget = { totalKb: 3072, fileKb: 600, heroKb: 400 } as const;

const web = (id: string, what: string, theme: Shot['theme'] = 'dark', width: number = stillWidth): Shot =>
  ({ id: `web-${id}${theme === 'light' ? '-light' : ''}`, file: `web-${id}${theme === 'light' ? '-light' : ''}.webp`, kind: 'still', client: 'web', width, theme, what });
const tui = (id: string, what: string): Shot => ({ id: `tui-${id}`, file: `tui-${id}.webp`, kind: 'still', client: 'tui', width: 1100, theme: 'dark', what });
const gif = (id: string, client: 'web' | 'tui', what: string): Shot =>
  ({ id, file: `${id}.gif`, kind: 'gif', client, width: client === 'web' ? gifWebWidth : gifTuiWidth, theme: 'dark', what });

export const shots: readonly Shot[] = [
  { id: 'hero-dark', file: 'hero-dark.webp', kind: 'hero', client: 'both', width: 1280, theme: 'dark', what: 'Web Overview with the TUI laid over it (midnight)' },
  { id: 'hero-light', file: 'hero-light.webp', kind: 'hero', client: 'both', width: 1280, theme: 'light', what: 'The same composition on the dawn theme' },
  web('overview', 'Overview: the Needs you inbox, the fleet pulse strip and the context-pressure histogram'),
  web('overview', 'Overview on the dawn (light) theme', 'light'),
  web('pulse', 'Close-up of the fleet pulse, status strip and pressure histogram', 'dark', 1100),
  web('fleet', 'Fleet table with fixed status semantics'),
  web('session-resets', 'Session transcript scrolled to a ⟲ reset divider with what was carried over and interrupted'),
  web('session-resets', 'Reset divider on the dawn theme', 'light'),
  web('graph', 'Messages graph: who talked to whom, nodes coloured by status'),
  web('timeline', 'Zoomed timeline of sessions, jobs and resets'),
  web('themes', 'Theme preview cards in Settings: midnight, dawn, high contrast', 'dark', 1100),
  tui('overview', 'TUI Overview (midnight)'),
  tui('session-resets', 'TUI transcript at a reset divider'),
  tui('palette', 'TUI command palette with typed groups'),
  tui('mono', 'TUI in the mono theme (NO_COLOR-safe)'),
  gif('web-palette', 'web', 'Ctrl+P, type "aur", the palette ranks matches by group, Enter opens the session'),
  gif('web-tour', 'web', 'Keyboard tour: Overview, Fleet, a session at its reset divider, Timeline'),
  gif('tui-tour', 'tui', 'TUI tour: Overview, Fleet, a session, the command palette, Timeline'),
];

export const byId = (id: string): Shot => {
  const shot = shots.find(candidate => candidate.id === id);
  if (!shot) throw new Error(`Unknown shot ${id}`);
  return shot;
};
