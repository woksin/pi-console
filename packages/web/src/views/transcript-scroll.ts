import type { TranscriptLine } from '@pi-console/viewmodels';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useJumpOnce } from './transcript-jump.ts';
import { useFollow } from './transcript-pause.ts';

interface Anchor { id: string; top: number }

const lineId = (element: Element): string => element.id.slice('line-'.length);

/** The first line at or below the top edge of the pane, with its offset from that edge. */
function capture(pane: HTMLElement): Anchor | null {
  const edge = pane.getBoundingClientRect().top;
  for (const element of pane.querySelectorAll('[id^="line-"]')) {
    const box = element.getBoundingClientRect();
    if (box.bottom - edge > 0) return { id: lineId(element), top: box.top - edge };
  }
  return null;
}

/** Puts the anchored line back at its captured offset; eviction clamps to the nearest surviving edge. */
function restore(pane: HTMLElement, anchor: Anchor | null, lines: readonly TranscriptLine[]): void {
  if (!anchor) return;
  const exact = document.getElementById(`line-${anchor.id}`);
  const nearest = Number(anchor.id) > (lines.at(-1)?.key ?? 0) ? lines.at(-1) : lines[0];
  const element = exact ?? (nearest ? document.getElementById(`line-${nearest.key}`) : null);
  if (!element) return;
  const delta = element.getBoundingClientRect().top - pane.getBoundingClientRect().top - (exact ? anchor.top : 0);
  if (Math.abs(delta) > 0.5) pane.scrollTop += delta;
}

/** While paused the viewport is pinned to a line id (never an index or offset): eviction at the retention cap or a history merge moves content, and the pinned line is brought back to the same screen position. */
function useAnchor(pane: RefObject<HTMLDivElement | null>, follow: boolean, lines: readonly TranscriptLine[]): { remember: () => void } {
  const anchor = useRef<Anchor | null>(null);
  useLayoutEffect(() => {
    if (!pane.current) return;
    // Following owns the viewport: a stale anchor from an earlier pause must not pull the next pause back to it.
    if (follow) { anchor.current = null; return; }
    restore(pane.current, anchor.current, lines);
    anchor.current = capture(pane.current);
  }, [pane, follow, lines]);
  return { remember: () => { if (pane.current) anchor.current = capture(pane.current); } };
}

/** Identifies the tail's content and size: a collapsed streaming run grows without changing the last key or the line count. */
const tailSignature = (lines: readonly TranscriptLine[]): string => {
  const tail = lines.at(-1);
  return `${String(tail?.key)}:${String(lines.length)}:${String(tail?.text.length)}`;
};

/** Moves only the transcript pane to its end; `scrollIntoView` would also scroll the page around it. */
const toEnd = (pane: HTMLElement | null): void => { if (pane) pane.scrollTop = pane.scrollHeight; };

/** While following, a line that grows after the tail scroll (an off-screen `content-visibility: auto` line rendering at full height, a wrap change) must not push the tail out of view. One observer per follow period watches the wrapper of all lines; it does nothing once paused, even before its cleanup runs. */
function useKeepTail(pane: RefObject<HTMLDivElement | null>, body: RefObject<HTMLDivElement | null>, follow: boolean, following: RefObject<boolean>): void {
  useEffect(() => {
    const content = follow ? body.current : null;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (following.current) toEnd(pane.current); });
    observer.observe(content);
    return () => { observer.disconnect(); };
  }, [pane, body, follow, following]);
}

export interface TranscriptScroll {
  follow: boolean;
  pause: () => void;
  toggleFollow: () => void;
  pane: RefObject<HTMLDivElement | null>;
  body: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  remember: () => void;
}

/** Follow-the-tail, pause on user scroll, anchoring on a line id while paused, and the one-time scroll to a jump target. */
export function useTranscriptScroll(lines: readonly TranscriptLine[], focusEntry: string | null, onResume: () => void, onFollow: (following: boolean) => void): TranscriptScroll {
  const { follow, following, pause, toggleFollow } = useFollow(focusEntry === null, onResume, onFollow);
  const pane = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const tail = tailSignature(lines);
  useEffect(() => { if (follow) toEnd(pane.current); }, [follow, tail]);
  useKeepTail(pane, body, follow, following);
  const { remember } = useAnchor(pane, follow, lines);
  useJumpOnce(lines, focusEntry, remember);
  return { follow, pause, toggleFollow, pane, body, onScroll: () => { if (!follow) remember(); }, remember };
}
