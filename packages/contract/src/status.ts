import type { ThemeToken } from './theme.ts';

/** Session status taxonomy (docs/api/v0.md). The seven values of `session.status`. */
export const sessionStatuses = ['working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed'] as const;
export type SessionStatus = typeof sessionStatuses[number];

export interface StatusToken {
  /** Single-cell glyph; never the only carrier of meaning (label always rendered next to it in the web UI). */
  glyph: string;
  color: ThemeToken;
  tint: string;
  label: string;
}

const token = (glyph: string, color: ThemeToken, label: string): StatusToken => ({
  glyph, color, label, tint: `color-mix(in srgb, var(--${color}) 14%, transparent)`,
});

/** Every status word used by any view (sessions, requests, jobs). One table, shared by web and TUI. */
export const statusTaxonomy: Record<string, StatusToken> = {
  'needs-you': token('!', 'amber', 'Needs you'),
  working: token('*', 'cyan', 'Working'),
  running: token('*', 'cyan', 'Running'),
  queued: token('◷', 'muted', 'Queued'),
  blocked: token('×', 'orange', 'Blocked'),
  failed: token('#', 'red', 'Failed'),
  waiting: token('~', 'violet', 'Waiting'),
  interrupted: token('/', 'pink', 'Interrupted'),
  done: token('✓', 'green', 'Done'),
  answered: token('✓', 'green', 'Answered'),
  unanswered: token('!', 'amber', 'Unanswered'),
  open: token('!', 'amber', 'Open'),
  'answer-possibly-unseen': token('¿', 'orange', 'Possibly unseen'),
  idle: token('–', 'faint', 'Idle'),
  stale: token('?', 'muted', 'Stale'),
};

const unknownStatus: StatusToken = token('·', 'muted', 'Unknown');

export const statusToken = (value: string): StatusToken => statusTaxonomy[value] ?? unknownStatus;
