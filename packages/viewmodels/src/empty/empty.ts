import type { ThemeToken } from '@pi-console/contract';

/** A purposeful empty state (information architecture §8), worded once for web and TUI. */
export interface EmptyStateModel { title: string; body: string; mark: string }

export type EmptyView = 'fleet' | 'requests' | 'questions' | 'messages' | 'graph' | 'timeline' | 'work';

/** What each view says when the daemon has nothing for it yet (not when a filter hides everything). */
export const emptyStates: Readonly<Record<EmptyView, EmptyStateModel>> = {
  fleet: { title: 'No pi sessions found yet.', mark: '◌', body: 'The daemon reads pi session logs under ~/.pi/agent.' },
  requests: { title: 'No requests recorded yet.', mark: '⇄', body: 'Every prompt sent to an agent is tracked with its answer, labelled by how sure the daemon is who asked.' },
  questions: { title: 'No open questions.', mark: '?', body: 'Agents ask here when they need you.' },
  messages: { title: 'No messages yet.', mark: '⌬', body: 'Messages sent between agents appear here, with whether they were delivered and read.' },
  graph: { title: 'Waiting for activity', mark: '⌬', body: 'Edges appear when sessions message each other or spawn subagents.' },
  timeline: { title: 'Waiting for activity', mark: '▭', body: 'Requests, answers, resets, questions and messages are placed on one time axis as they happen.' },
  work: { title: 'No work in flight.', mark: '⚙', body: 'Jobs, phases and CI runs show up here with their exit codes.' },
};

/** The calm Overview when nothing needs the user: the working count is promoted, as the information architecture asks. */
export function overviewEmpty(working: number): EmptyStateModel {
  const now = working === 0 ? 'No session is working right now.' : `${String(working)} ${working === 1 ? 'session is' : 'sessions are'} working.`;
  return { title: 'Nothing needs you.', mark: '✓', body: now };
}

export interface ChecklistStep { label: string; detail: string; state: 'done' | 'todo' | 'optional'; glyph: string; color: ThemeToken }

const step = (label: string, state: ChecklistStep['state'], detail: string): ChecklistStep => ({
  label, state, detail, glyph: state === 'done' ? '✓' : state === 'todo' ? '○' : '◇', color: state === 'done' ? 'green' : state === 'todo' ? 'amber' : 'muted',
});

/**
 * First run: daemon running, sources detected, extension installed (optional). Shown while the daemon reports no
 * sessions at all; the extension cannot be detected read-only, so it stays optional rather than pretending to know.
 */
export function firstRunChecklist(input: { connected: boolean; sessions: number }): { title: string; steps: ChecklistStep[] } {
  return {
    title: 'Getting started',
    steps: [
      input.connected ? step('Daemon running', 'done', 'Connected to the local pi-console daemon.') : step('Daemon running', 'todo', 'From a checkout, run: node packages/cli/bin/pi-console.mjs daemon --web-dist packages/web/dist'),
      input.sessions > 0 ? step('Sources detected', 'done', `${String(input.sessions)} pi sessions found.`) : step('Sources detected', 'todo', 'Waiting for pi session logs under ~/.pi/agent. Start pi in any repository.'),
      step('Extension installed', 'optional', 'Optional: the pi-console extension adds memory review; the console works from logs without it. Install steps: README, "Install the pi extension".'),
    ],
  };
}
