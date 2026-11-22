import type { TranscriptLoad, TranscriptProgress } from '../state/transcript-history.ts';

interface ScrollPosition {
  previousTop: number; top: number;
  progress?: TranscriptProgress; following: boolean; searching: boolean;
}

export function historyControls(progress: TranscriptProgress | undefined, following: boolean): { busy: boolean; showLive: boolean } {
  return { busy: progress?.loading !== undefined, showLive: !following || progress?.newer === true };
}

function olderAllowed({ progress, following, searching }: ScrollPosition): boolean {
  return !following && !searching && progress?.older === true && !progress.loading;
}

function reachedTop({ previousTop, top }: ScrollPosition): boolean {
  return top < previousTop && top <= 2;
}

export function shouldLoadOlder(position: ScrollPosition): boolean {
  return reachedTop(position) && olderAllowed(position);
}

export function retryDirection(error: TranscriptLoad | undefined): 'older' | 'newer' | 'tail' {
  return error === 'older' || error === 'newer' ? error : 'tail';
}
