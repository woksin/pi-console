/**
 * The one place that decides which transcript lines are on screen. Rendering and every scroll
 * action call it, so they cannot disagree about coordinates.
 *
 * A paused viewport is stored as a stable position (the stable key of the entry at its top and a
 * wrapped-line offset inside that entry) plus `limit`, the newest key seen when it paused.
 * Neither is an array index or a line count, so appending or evicting entries older than the
 * anchor never moves the view, and re-wrapping keeps the anchor entry at the top.
 */

/** Rendered shape of the retained transcript: per entry its stable key (see TranscriptLine.key) and the cumulative end line (exclusive). */
export interface TranscriptLayout { keys: readonly number[]; ends: readonly number[] }
export const emptyLayout: TranscriptLayout = { keys: [], ends: [] };

export interface TranscriptAnchor { key: number; offset: number; limit: number }
/** The part of the UI state that positions the transcript. `anchor` is null while following the tail (or when paused with nothing to hold still, which also shows the tail). */
export interface TranscriptView { follow: boolean; anchor: TranscriptAnchor | null }

export interface TranscriptWindow {
  /** First and one-past-last line shown, in rendered-line coordinates of the current layout. */
  start: number; end: number;
  /** Lines newer than the window ("above live" in the label). */
  below: number;
  paused: boolean;
  /** The anchor entry was evicted: the view is clamped to the oldest retained entry and one row is spent on a marker. */
  dropped: boolean;
}

/** Transcript rows inside a body `height` (minus the header panel and the panel borders); the session view and the reducer both use it. */
export const transcriptViewport = (height: number): number => Math.max(1, height - 7);

export type TranscriptMotion = number | 'top' | 'bottom';

const total = (layout: TranscriptLayout): number => layout.ends.at(-1) ?? 0;
const startOf = (layout: TranscriptLayout, index: number): number => (index === 0 ? 0 : layout.ends[index - 1]);
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** End line of the newest entry at or before `limit`; at least the oldest retained entry, as the limit itself may be evicted. */
function limitEnd(layout: TranscriptLayout, limit: number): number {
  const newer = layout.keys.findIndex(key => key > limit);
  const last = newer < 0 ? layout.keys.length - 1 : newer - 1;
  return layout.ends[Math.max(0, last)] ?? 0;
}

/** Top line of the anchor entry (plus its offset, kept inside the entry); the end of the transcript if the anchor is newer than everything. */
function topOf(layout: TranscriptLayout, anchor: TranscriptAnchor): number {
  const index = layout.keys.findIndex(key => key >= anchor.key);
  if (index < 0) return total(layout);
  const offset = layout.keys[index] === anchor.key ? anchor.offset : 0;
  return startOf(layout, index) + clamp(offset, 0, layout.ends[index] - startOf(layout, index) - 1);
}

const isDropped = (layout: TranscriptLayout, anchor: TranscriptAnchor): boolean => layout.keys.length > 0 && anchor.key < layout.keys[0];

/** Stable position of a rendered line, or null for an empty transcript. */
function positionAt(layout: TranscriptLayout, line: number, limit: number): TranscriptAnchor | null {
  if (layout.keys.length === 0) return null;
  const index = Math.max(0, layout.ends.findIndex(end => end > line));
  return { key: layout.keys[index], offset: Math.max(0, line - startOf(layout, index)), limit };
}

export function transcriptWindow(layout: TranscriptLayout, view: TranscriptView, height: number): TranscriptWindow {
  const all = total(layout);
  const anchor = view.anchor;
  if (!anchor) return { start: Math.max(0, all - height), end: all, below: 0, paused: !view.follow, dropped: false };
  const dropped = isDropped(layout, anchor);
  const rows = dropped ? Math.max(1, height - 1) : height;
  const bottom = limitEnd(layout, anchor.limit);
  const start = clamp(topOf(layout, anchor), 0, Math.max(0, bottom - rows));
  const end = Math.min(bottom, start + rows);
  return { start, end, below: all - end, paused: true, dropped };
}

/** Pauses at the current view; an empty transcript has nothing to hold still, so it keeps showing the tail. */
export function pauseTranscript(layout: TranscriptLayout, view: TranscriptView, height: number): TranscriptView {
  const position = positionAt(layout, transcriptWindow(layout, view, height).start, limitOf(layout, view));
  return { follow: false, anchor: view.anchor ?? position };
}

export const resumeTranscript: TranscriptView = { follow: true, anchor: null };

const limitOf = (layout: TranscriptLayout, view: TranscriptView): number => view.anchor?.limit ?? layout.keys.at(-1) ?? 0;
/** Line just past the newest line the view may show: the pause point while paused, else the end. */
const bottomOf = (layout: TranscriptLayout, view: TranscriptView): number => (view.anchor ? limitEnd(layout, view.anchor.limit) : total(layout));

function targetLine(current: TranscriptWindow, motion: number | 'top', maximum: number): number {
  return clamp(motion === 'top' ? 0 : current.start + motion, 0, maximum);
}

/** Moves the viewport by `motion` lines (negative is older), clamped by the same bounds the window uses. Reaching the live bottom resumes following. */
export function scrollTranscript(layout: TranscriptLayout, view: TranscriptView, height: number, motion: TranscriptMotion): TranscriptView {
  if (motion === 'bottom') return resumeTranscript;
  const bottom = bottomOf(layout, view);
  const maximum = Math.max(0, bottom - height);
  const current = transcriptWindow(layout, view, height);
  const target = targetLine(current, motion, maximum);
  if (current.dropped && target === 0) return view;
  const position = positionAt(layout, target, limitOf(layout, view));
  const live = target >= maximum && bottom === total(layout);
  return position && !live ? { follow: false, anchor: position } : resumeTranscript;
}
