import type { TranscriptLine } from '@pi-console/viewmodels';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useActions } from '../app/commands.ts';
import { isTyping } from '../app/keys.ts';

interface Anchor { id: string; top: number }

const lineId = (element: Element): string => element.id.slice('line-'.length);
const pausingKeys = ['PageUp', 'ArrowUp', 'Home', 'k', 'g'];

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
  const element = exact ?? (lines.length > 0 ? document.getElementById(`line-${lines[0].id}`) : null);
  if (!element) return;
  const delta = element.getBoundingClientRect().top - pane.getBoundingClientRect().top - (exact ? anchor.top : 0);
  if (Math.abs(delta) > 0.5) pane.scrollTop += delta;
}

/** Reading back up is a deliberate act: a user scroll away from the tail pauses following. */
function usePauseOnUserScroll(pause: () => void): void {
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => { if (event.deltaY < 0) pause(); };
    const onKey = (event: KeyboardEvent): void => { if (!isTyping(event.target) && pausingKeys.includes(event.key)) pause(); };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', pause, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('touchmove', pause); window.removeEventListener('keydown', onKey); };
  }, [pause]);
}

/** While paused the viewport is pinned to a line id (never an index or offset): eviction at the retention cap or a history merge moves content, and the pinned line is brought back to the same screen position. */
function useAnchor(pane: RefObject<HTMLDivElement | null>, follow: boolean, lines: readonly TranscriptLine[]): { remember: () => void } {
  const anchor = useRef<Anchor | null>(null);
  useLayoutEffect(() => {
    if (follow || !pane.current) return;
    restore(pane.current, anchor.current, lines);
    anchor.current = capture(pane.current);
  }, [pane, follow, lines]);
  return { remember: () => { if (!follow && pane.current) anchor.current = capture(pane.current); } };
}

/** Scrolls to the jump target once per target, after its line has loaded. */
function useJumpOnce(focusEntry: string | null, loaded: number, onJumped: () => void): void {
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const target = focusEntry && jumped.current !== focusEntry ? document.getElementById(`line-${focusEntry}`) : null;
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    jumped.current = focusEntry;
    onJumped();
  }, [focusEntry, loaded, onJumped]);
}

export interface TranscriptScroll { follow: boolean; pause: () => void; toggleFollow: () => void; pane: RefObject<HTMLDivElement | null>; end: RefObject<HTMLDivElement | null>; onScroll: () => void }

/** Follow-the-tail, pause on user scroll, anchoring on a line id while paused, and the one-time scroll to a jump target. */
export function useTranscriptScroll(lines: readonly TranscriptLine[], focusEntry: string | null): TranscriptScroll {
  const [follow, setFollow] = useState(focusEntry === null);
  const pane = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const pause = useCallback((): void => { setFollow(false); }, []);
  const toggleFollow = (): void => { setFollow(value => !value); };
  useActions(action => { if (action !== 'follow.toggle') return false; toggleFollow(); return true; });
  usePauseOnUserScroll(pause);
  const last = lines.at(-1)?.id;
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: 'end' }); }, [follow, last, lines.length]);
  const { remember } = useAnchor(pane, follow, lines);
  useJumpOnce(focusEntry, lines.length, remember);
  return { follow, pause, toggleFollow, pane, end, onScroll: remember };
}
