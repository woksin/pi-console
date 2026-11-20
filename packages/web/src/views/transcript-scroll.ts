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

/** Puts the anchored line back at its captured offset; if it was evicted, the oldest surviving line is the nearest honest position. */
function restore(pane: HTMLElement, anchor: Anchor | null, lines: readonly TranscriptLine[]): void {
  if (!anchor) return;
  const exact = document.getElementById(`line-${anchor.id}`);
  const element = exact ?? (lines.length > 0 ? document.getElementById(`line-${lines[0].key}`) : null);
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

export interface TranscriptScroll { follow: boolean; pause: () => void; toggleFollow: () => void; pane: RefObject<HTMLDivElement | null>; end: RefObject<HTMLDivElement | null>; onScroll: () => void; remember: () => void }

/** Follow-the-tail, pause on user scroll, anchoring on a line id while paused, and the one-time scroll to a jump target. */
export function useTranscriptScroll(lines: readonly TranscriptLine[], focusEntry: string | null): TranscriptScroll {
  const { follow, pause, toggleFollow } = useFollow(focusEntry === null);
  const pane = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const tail = tailSignature(lines);
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: 'end' }); }, [follow, tail]);
  const { remember } = useAnchor(pane, follow, lines);
  useJumpOnce(lines, focusEntry, remember);
  return { follow, pause, toggleFollow, pane, end, onScroll: () => { if (!follow) remember(); }, remember };
}
