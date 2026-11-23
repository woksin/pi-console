import type { ReactElement } from 'react';
import { firstRunChecklist, wrap, type EmptyStateModel, type FlashTracker, type LookTracker, type TimeWindow, type TranscriptLine, type WindowedCollection, type TextWidth } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import { blank, t } from '../view/parts.ts';
import type { Data } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import type { TranscriptAnchor, TranscriptLayout } from '../state/transcript-window.ts';

/** Everything a view needs to draw one frame; built once per render by the app. */
export interface Env {
  data: Data; ui: UiState; now: number;
  /** Cell measurement selected by the active renderer; absent in isolated view specs. */
  measure?: TextWidth;
  /** Interior size of the body area (inside the header and footer). */
  width: number; height: number;
  /** Increases ~6 times a second while animation is on; always 0 when it is off. */
  phase: number;
  /** Row activation by mouse: moves the cursor and opens. */
  click: (index: number) => void;
  /** What changed on the Overview since the user last looked; flashes only when `motion` is on. Absent in isolated view specs. */
  changes?: { look: LookTracker; flash: FlashTracker; motion: boolean };
}

export interface SectionView {
  /** Number of selectable rows; the reducer clamps the cursor to it. */
  length: number;
  /** Full-width detail viewport, when a list supports narrow-terminal detail. */
  detail?: { max: number; page: number };
  rowAt: (index: number) => { sessionId: string | null; groupId: string | null; entryId?: string | null };
  /** Requests only: the sessions the session filter cycles through. */
  sessionIds?: readonly string[];
  /** Session view only: where to scroll for `ui.focusEntry`; undefined until the entry is in the transcript. */
  focus?: () => TranscriptAnchor | undefined;
  render: () => ReactElement;
  /** Timeline or graph: the fitted time range and grid width used for time controls. */
  time?: { fit: TimeWindow; width: number };
  /** Session view only: the rendered shape of the transcript, which the reducer scrolls through. */
  transcript?: TranscriptLayout;
  transcriptRows?: number;
  /** Session view only: the entries behind the layout, for the full-entry viewer. */
  entries?: readonly TranscriptLine[];
  /** Id shown by `y copy id`. */
  idAt: (index: number) => string | null;
}

export const noRow = { sessionId: null, groupId: null } as const;
export const bySession = (data: Data) => new Map(data.sessions.map(session => [session.id, session]));

/** " · N of T loaded" while a windowed list has older history on the daemon; empty when the list is complete. */
export const shownOf = (data: Env['data'], collection: WindowedCollection, shown: number): string => {
  const total = data.totals?.[collection];
  return data.bounded.includes(collection) && total !== undefined && shown < total ? ` · ${String(shown)} of ${String(total)} loaded` : '';
};

/** A view's empty state (information architecture §8) as lines: the same title and explanation the web shows. */
export const emptyLines = (model: EmptyStateModel, width: number): Line[] => [
  blank,
  [t(`  ${model.mark} `, 'cyan', { bold: true }), t(model.title, 'text', { bold: true })],
  ...wrap(model.body, Math.max(10, width - 4)).map((text): Line => [t(`    ${text}`, 'muted')]),
];

/** What a list shows before the first snapshot has arrived: not an empty state, because nothing is known yet. */
export const loadingLines = (): Line[] => [blank, [t('  Loading…', 'muted')]];

/** `lines()` once the first snapshot has arrived, `Loading…` before. */
export const whenLoaded = (loaded: boolean, lines: () => Line[]): Line[] => loaded ? lines() : loadingLines();

/** A filter that excludes every row; the same line on every list. */
export const noMatchLines = (noun: string, query: string): Line[] =>
  [blank, [t(`  No ${noun} matches `, 'muted'), t(`“${query}”`, 'amber'), t('. Esc clears the filter.', 'muted')]];

interface ListBody { loaded: boolean; lines: Line[]; query: string; noun: string; anyRows: boolean; empty: () => Line[] }

/** A list's body: loading until the first snapshot, its rows, a no-match line when the filter hides everything, or the view's empty state. */
export function listBody(input: ListBody): Line[] {
  if (!input.loaded) return loadingLines();
  if (input.lines.length > 0) return input.lines;
  return input.anyRows && input.query ? noMatchLines(input.noun, input.query) : input.empty();
}

/** The first-run checklist (daemon running, sources detected, extension optional), shown while there are no sessions. */
export function checklistLines(input: { connected: boolean; sessions: number }, width: number): Line[] {
  const checklist = firstRunChecklist(input);
  return [blank, [t(`  ${checklist.title}`, 'text', { bold: true })], ...checklist.steps.flatMap((step): Line[] => [
    [t(`  ${step.glyph} `, step.color, { bold: true }), t(step.label, 'text'), t(step.state === 'todo' ? ' (not yet)' : step.state === 'optional' ? ' (optional)' : '', 'muted')],
    ...wrap(step.detail, Math.max(10, width - 6)).map((text): Line => [t(`    ${text}`, 'muted')]),
  ])];
}
