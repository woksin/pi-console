import { useRef } from 'react';
import type { TranscriptProgress } from '../state/transcript-history.ts';
import { EmptyState } from '../ui/primitives.tsx';
import type { TranscriptScroll } from './transcript-scroll.ts';
import { historyControls, retryDirection, shouldLoadOlder } from './transcript-history-controls.ts';

interface HistoryActions {
  progress?: TranscriptProgress;
  onPage: (direction: 'older' | 'newer') => void; onLive: () => void;
}

function HistoryControls({ progress, onPage, onLive }: HistoryActions) {
  if (!progress) return null;
  const retry = (): void => {
    const direction = retryDirection(progress.error);
    if (direction === 'tail') onLive();
    else onPage(direction);
  };
  const { busy } = historyControls(progress);
  return <>
    {progress.older && <button type="button" className="btn" disabled={busy} onClick={() => { onPage('older'); }}>Load older</button>}
    {progress.newer && <button type="button" className="btn" disabled={busy} onClick={() => { onPage('newer'); }}>Load newer</button>}
    {progress.loading && <span role="status">Loading {progress.loading}…</span>}
    {progress.error && <span role="alert">Could not load {progress.error}. <button type="button" className="btn" onClick={retry}>Retry</button></span>}
  </>;
}

function FollowControls({ scroll, progress, onLive }: Pick<HistoryActions, 'progress' | 'onLive'> & { scroll: TranscriptScroll }) {
  const { busy, showLive } = historyControls(progress);
  if (showLive) return <button type="button" className="btn follow" disabled={busy} onClick={onLive}>Return to live</button>;
  return <button type="button" className="btn follow" aria-pressed={scroll.follow} disabled={busy} onClick={scroll.toggleFollow}>{scroll.follow ? '● Following' : '○ Follow tail'} <kbd className="kbd">f</kbd></button>;
}

export function TranscriptHistoryBar({ scroll, progress, onPage, onLive }: HistoryActions & { scroll: TranscriptScroll }) {
  return <div className="transcript-controls">
    <FollowControls scroll={scroll} progress={progress} onLive={onLive} />
    <HistoryControls progress={progress} onPage={onPage} onLive={onLive} />
  </div>;
}

/** Captures the visible anchor before either explicit paging or scrolling into the older edge. */
export function useTranscriptHistoryPaging(scroll: TranscriptScroll, progress: TranscriptProgress | undefined, searching: boolean, onPage: HistoryActions['onPage']): { page: HistoryActions['onPage']; onScroll: () => void } {
  const previousTop = useRef(0);
  const page: HistoryActions['onPage'] = direction => { scroll.pause(); scroll.remember(); onPage(direction); };
  const onScroll = (): void => {
    scroll.onScroll();
    const top = scroll.pane.current?.scrollTop ?? 0;
    const loadOlder = shouldLoadOlder({ previousTop: previousTop.current, top, progress, following: scroll.follow, searching });
    previousTop.current = top;
    if (loadOlder) page('older');
  };
  return { page, onScroll };
}

function EmptyTranscriptMessage({ searching }: { searching: boolean }) {
  return <EmptyState title={searching ? 'No lines match' : 'No transcript yet'} mark="…">{searching ? 'Clear the search to see the whole transcript.' : 'Lines stream in here as the agent works.'}</EmptyState>;
}

export function TranscriptEmptyState({ empty, searching, progress }: { empty: boolean; searching: boolean; progress?: TranscriptProgress }) {
  if (!empty || progress?.loading) return null;
  return <EmptyTranscriptMessage searching={searching} />;
}
