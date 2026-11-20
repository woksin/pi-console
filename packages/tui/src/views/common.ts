import type { ReactElement } from 'react';
import type { TimeWindow } from '@pi-console/viewmodels';
import type { Data } from '../store/store.ts';
import type { UiState } from '../state/ui.ts';
import type { TranscriptLayout } from '../state/transcript-window.ts';

/** Everything a view needs to draw one frame; built once per render by the app. */
export interface Env {
  data: Data; ui: UiState; now: number;
  /** Interior size of the body area (inside the header and footer). */
  width: number; height: number;
  /** Increases ~6 times a second while animation is on; always 0 when it is off. */
  phase: number;
  /** Row activation by mouse: moves the cursor and opens. */
  click: (index: number) => void;
}

export interface SectionView {
  /** Number of selectable rows; the reducer clamps the cursor to it. */
  length: number;
  rowAt: (index: number) => { sessionId: string | null; groupId: string | null };
  render: () => ReactElement;
  /** Timeline only: the fitted window and the grid width, which the reducer needs to pan, zoom and scrub. */
  time?: { fit: TimeWindow; width: number };
  /** Session view only: the rendered shape of the transcript, which the reducer scrolls through. */
  transcript?: TranscriptLayout;
  /** Id shown by `y copy id`. */
  idAt: (index: number) => string | null;
}

export const noRow = { sessionId: null, groupId: null } as const;
export const bySession = (data: Data) => new Map(data.sessions.map(session => [session.id, session]));
