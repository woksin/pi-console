import type { ThemeToken } from './theme.ts';

/** Session status taxonomy (docs/api/v0.md). The seven values of `session.status`. */
export const sessionStatuses = ['working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed'] as const;
export type SessionStatus = typeof sessionStatuses[number];

export interface StatusToken {
  /** Single-cell glyph; never the only carrier of meaning (label always rendered next to it in the web UI). */
  glyph: string;
  color: ThemeToken;
  label: string;
}

/** Every status word used by any view (sessions, requests, jobs). One table, shared by web and TUI. */
export const statusTaxonomy: Record<string, StatusToken> = {
  'needs-you': { glyph: '!', color: 'amber', label: 'Needs you' },
  working: { glyph: '*', color: 'cyan', label: 'Working' },
  running: { glyph: '*', color: 'cyan', label: 'Running' },
  blocked: { glyph: '×', color: 'orange', label: 'Blocked' },
  failed: { glyph: '×', color: 'red', label: 'Failed' },
  waiting: { glyph: '~', color: 'violet', label: 'Waiting' },
  interrupted: { glyph: '/', color: 'pink', label: 'Interrupted' },
  done: { glyph: '✓', color: 'green', label: 'Done' },
  answered: { glyph: '✓', color: 'green', label: 'Answered' },
  unanswered: { glyph: '!', color: 'amber', label: 'Unanswered' },
  open: { glyph: '!', color: 'amber', label: 'Open' },
  'answer-possibly-unseen': { glyph: '?', color: 'orange', label: 'Answer possibly unseen' },
  idle: { glyph: '–', color: 'faint', label: 'Idle' },
};

const unknownStatus: StatusToken = { glyph: '·', color: 'muted', label: 'Unknown' };

export const statusToken = (value: string): StatusToken => statusTaxonomy[value] ?? unknownStatus;
