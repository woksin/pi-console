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

export const budget = { totalKb: 6144, fileKb: 600, heroKb: 400, recordingKb: 700 } as const;

const web = (id: string, what: string, theme: Shot['theme'] = 'dark', width: number = stillWidth): Shot =>
  ({ id: `web-${id}${theme === 'light' ? '-light' : ''}`, file: `web-${id}${theme === 'light' ? '-light' : ''}.webp`, kind: 'still', client: 'web', width, theme, what });
const tui = (id: string, what: string): Shot => ({ id: `tui-${id}`, file: `tui-${id}.webp`, kind: 'still', client: 'tui', width: 1100, theme: 'dark', what });
const gif = (id: string, client: 'web' | 'tui', what: string): Shot =>
  ({ id, file: `${id}.gif`, kind: 'gif', client, width: client === 'web' ? gifWebWidth : gifTuiWidth, theme: 'dark', what });

// The seven sidebar sections, Messages' graph mode, Session detail and Settings.
export const webViews = [
  { id: 'overview', route: '/overview', what: 'Overview: Needs you inbox and fleet pulse' },
  { id: 'fleet', route: '/fleet', what: 'Fleet: sessions grouped by repository' },
  { id: 'requests', route: '/requests', what: 'Requests and answers' },
  { id: 'questions', route: '/questions', what: 'Questions and decisions' },
  { id: 'messages', route: '/messages', what: 'Messages list' },
  { id: 'graph', route: '/messages?view=graph', what: 'Lane communication graph: lane-to-lane message edges' },
  { id: 'timeline', route: '/timeline', what: 'Timeline of requests, answers, resets, questions and messages' },
  { id: 'work', route: '/work', what: 'Work: jobs, phases and CI' },
  { id: 'session', route: '/session/s2', what: 'Session transcript at the tail with producer-owned memory review controls' },
  { id: 'transcript-history', route: '/session/s2', what: 'Transcript opened at the live tail, then paused while loading older entries' },
  { id: 'settings', route: '/settings', what: 'Settings: connection, data and appearance' },
] as const;

export const shots: readonly Shot[] = [
  ...webViews.flatMap(view => [web(view.id, `${view.what} (midnight)`), web(view.id, `${view.what} (dawn)`, 'light')]),
  { id: 'hero-dark', file: 'hero-dark.webp', kind: 'hero', client: 'both', width: 1280, theme: 'dark', what: 'Web Overview with the TUI laid over it (midnight)' },
  { id: 'hero-light', file: 'hero-light.webp', kind: 'hero', client: 'both', width: 1280, theme: 'light', what: 'The same composition on the dawn theme' },
  web('pulse', 'Close-up of the fleet pulse, status strip and pressure histogram', 'dark', 1100),
  web('session-resets', 'Session transcript scrolled to a ⟲ reset divider with what was carried over and interrupted'),
  web('session-resets', 'Reset divider on the dawn theme', 'light'),
  web('help', 'The ? keyboard help overlay, generated from the keymap'),
  web('offline', 'Daemon unreachable: the last data stays on screen under the Disconnected banner, with the as-of time'),
  web('themes', 'Theme preview cards in Settings: midnight, dawn, high contrast', 'dark', 1100),
  ...(['dark', 'light'] as const).flatMap(theme => [
    web('timeline-history', 'Timeline with explicit loaded/total counts and older-message history controls', theme),
    web('attention-retry', 'Attention unavailable state with an explicit Retry action', theme),
  ]),
  tui('overview', 'TUI Overview (midnight)'),
  tui('session-resets', 'TUI transcript at a reset divider'),
  tui('palette', 'TUI command palette with typed groups'),
  tui('mono', 'TUI in the mono theme (NO_COLOR-safe)'),
  tui('requests', 'Requests list with human, launch and unproven origin glyphs'),
  tui('questions', 'Questions list with sort and stale threshold in the title and a stale marker on idle open questions'),
  tui('question-expanded', 'Expanded question with wrapped text, options and its recorded history at a wide terminal size'),
  tui('memory-paging', 'Memory loaded/total progress and older-item navigation'),
  tui('memory-review', 'An older proposed memory item after backfill, with interactive-pi review commands'),
  tui('attention-retry', 'Attention unavailable header and retry hint without claiming an all-clear'),
  tui('settings-scroll', 'Short-terminal Settings scrolled to the final rows with position and keyboard hints'),
  web('connect', 'Connect to the daemon: the token screen a first visit without a launch link shows, with the Access token field and where to find the token'),
  web('first-run', 'First run: a connected daemon that has seen no sessions yet, with the checklist of what to set up'),
  gif('web-live-fleet', 'web', 'Live fleet over the real SSE stream: a working session finishes in Fleet, then a new blocking question raises the Needs you count on Overview'),
  gif('web-memory-review', 'web', 'Memory review of a proposed item: Confirm… requests it, pi awaits confirmation then ingestion, and only the producer\'s own update makes the item active'),
  gif('web-palette', 'web', 'Ctrl+P, type "aur", the palette ranks matches by group, Enter opens the session'),
  gif('web-tour', 'web', 'Keyboard tour: Overview, Fleet, a session at its reset divider, Timeline'),
  gif('tui-tour', 'tui', 'TUI tour: Overview, Fleet, a session, the command palette, Timeline'),
  gif('tui-vhs', 'tui', 'VHS recording of the real TUI against the isolated demo daemon: Overview, Fleet, Requests, Settings'),
];

/** The four live-state flows (`web-flows.ts`): each runs on its own rig and is never part of the paired stills. */
export const flowIds: readonly string[] = ['web-connect', 'web-first-run', 'web-live-fleet', 'web-memory-review'];

export const byId = (id: string): Shot => {
  const shot = shots.find(candidate => candidate.id === id);
  if (!shot) throw new Error(`Unknown shot ${id}`);
  return shot;
};
