import type { TranscriptLine } from '@pi-console/viewmodels';
import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/** The day of the first day section still showing at the top edge of the pane. */
function topDay(pane: HTMLElement): string {
  const edge = pane.getBoundingClientRect().top;
  for (const section of pane.querySelectorAll<HTMLElement>('.tday')) {
    if (section.getBoundingClientRect().bottom - edge > 0) return section.dataset.day ?? '';
  }
  return '';
}

/** The current day is shown outside the scroller, so no heading ever covers a line while following or paused; `update` runs on scroll. */
export function useCurrentDay(pane: RefObject<HTMLDivElement | null>, lines: readonly TranscriptLine[]): { day: string; update: () => void } {
  const [day, setDay] = useState('');
  const update = useCallback(() => { if (pane.current) setDay(topDay(pane.current)); }, [pane]);
  useLayoutEffect(() => { update(); }, [update, lines]);
  return { day, update };
}
