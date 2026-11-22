import { useRef } from 'react';
import { glyphs, type ResetRequest, type TranscriptLine } from '@pi-console/viewmodels';
import { useListNav } from '../app/hooks.ts';
import { focusKey } from './transcript-jump.ts';
import { useTranscriptScroll, type TranscriptScroll } from './transcript-scroll.ts';
import { EmptyState } from '../ui/primitives.tsx';
import type { TranscriptProgress } from '../state/transcript-history.ts';

interface TranscriptProps {
  lines: readonly TranscriptLine[]; focusEntry: string | null; searching: boolean;
  progress?: TranscriptProgress;
  onPage: (direction: 'older' | 'newer') => void; onLive: () => void;
}

type HistoryActions = Pick<TranscriptProps, 'progress' | 'onPage' | 'onLive'>;

function HistoryControls({ progress, onPage, onLive }: HistoryActions) {
  if (!progress) return null;
  const retry = (): void => {
    if (progress.error === 'older' || progress.error === 'newer') onPage(progress.error);
    else onLive();
  };
  const busy = progress.loading !== undefined;
  return <>
    {progress.older && <button type="button" className="btn" disabled={busy} onClick={() => { onPage('older'); }}>Load older</button>}
    {progress.newer && <button type="button" className="btn" disabled={busy} onClick={() => { onPage('newer'); }}>Load newer</button>}
    {progress.loading && <span role="status">Loading {progress.loading}…</span>}
    {progress.error && <span role="alert">Could not load {progress.error}. <button type="button" className="btn" onClick={retry}>Retry</button></span>}
  </>;
}

function FollowControls({ scroll, progress, onLive }: Pick<HistoryActions, 'progress' | 'onLive'> & { scroll: TranscriptScroll }) {
  const busy = progress?.loading !== undefined;
  return <>
    <button type="button" className="btn follow" aria-pressed={scroll.follow} disabled={busy} onClick={scroll.toggleFollow}>{scroll.follow ? '● Following' : '○ Follow tail'} <kbd className="kbd">f</kbd></button>
    {(!scroll.follow || progress?.newer) && <button type="button" className="btn" disabled={busy} onClick={onLive}>Return to live</button>}
  </>;
}

function olderAllowed(progress: TranscriptProgress | undefined, following: boolean, searching: boolean): boolean {
  return !following && !searching && progress?.older === true && !progress.loading;
}

function useOlderAtTop(scroll: TranscriptScroll, enabled: boolean, load: () => void): () => void {
  const previousTop = useRef(0);
  return () => {
    scroll.onScroll();
    const top = scroll.pane.current?.scrollTop ?? 0;
    const reachedTop = top < previousTop.current && top <= 2;
    previousTop.current = top;
    if (reachedTop && enabled) load();
  };
}

/** Every character is rendered as a React text node (escaped); transcript text is never interpreted as markup. */
export function Transcript({ lines, focusEntry, searching, progress, onPage, onLive }: TranscriptProps) {
  const scroll = useTranscriptScroll(lines, focusEntry, onLive);
  const page = (direction: 'older' | 'newer'): void => { scroll.pause(); scroll.remember(); onPage(direction); };
  const olderEnabled = olderAllowed(progress, scroll.follow, searching);
  const onScroll = useOlderAtTop(scroll, olderEnabled, () => { page('older'); });
  const nav = useListNav(lines.map(line => String(line.key)), {
    initial: focusKey(lines, focusEntry), fallback: String(lines.at(-1)?.key),
    onMove: key => { scroll.pause(); document.getElementById(`line-${key}`)?.scrollIntoView({ block: 'nearest' }); scroll.remember(); },
  });
  return (
    <div className="transcript-shell">
      <div className="transcript-controls">
        <FollowControls scroll={scroll} progress={progress} onLive={onLive} />
        <HistoryControls progress={progress} onPage={page} onLive={onLive} />
      </div>
      <div ref={scroll.pane} onScroll={onScroll} className="transcript" role="log" aria-live="off" aria-label="Transcript lines">
      {lines.length === 0 && !progress?.loading && <EmptyState title={searching ? 'No lines match' : 'No transcript yet'} mark="…">{searching ? 'Clear the search to see the whole transcript.' : 'Lines stream in here as the agent works.'}</EmptyState>}
      {lines.map(line => <Line key={line.key} line={line} selected={nav.selected === String(line.key)} focused={line.id === focusEntry} onSelect={() => { nav.select(String(line.key)); scroll.pause(); }} />)}
      <div ref={scroll.end} />
      </div>
    </div>
  );
}

function LineMeta({ line }: { line: TranscriptLine }) {
  const { tool } = line;
  return (
    <div className="tmeta"><span className="tlabel">{line.label}</span><time>{line.time}</time>{line.streaming && <span className="live-dot">streaming</span>}
      {tool && <span className="tool-name mono">{tool.name}</span>}{tool?.truncated && <span className="faint">truncated</span>}</div>
  );
}

function ResetRequests({ label, requests }: { label: string; requests: readonly ResetRequest[] }) {
  if (requests.length === 0) return null;
  return <div className="reset-list"><dt>{label}</dt>{requests.map(request => <dd key={request.id} title={request.text}><span className="mono faint">{request.id}</span> {request.text}</dd>)}</div>;
}

/** The inline `⟲` divider: kind and counts on the rule, then what was carried over and what was interrupted. */
function ResetDividerLine({ line }: { line: TranscriptLine }) {
  const { reset } = line;
  return (
    <div id={`line-${line.key}`} className="reset-marker" role="separator" aria-label={`Context reset at ${line.time}: ${reset?.summary ?? line.text}`}>
      <div className="reset-rule"><span className="reset-title">{glyphs.reset} {reset ? reset.summary : line.text || 'context reset'}</span><time>{line.time}</time></div>
      {reset && line.text && <p className="reset-note">{line.text}</p>}
      {reset && <dl className="reset-lists"><ResetRequests label="Carried over" requests={reset.carried} /><ResetRequests label="Interrupted" requests={reset.interrupted} /></dl>}
    </div>
  );
}

function Line({ line, selected, focused, onSelect }: { line: TranscriptLine; selected: boolean; focused: boolean; onSelect: () => void }) {
  if (line.kind === 'reset') return <ResetDividerLine line={line} />;
  return (
    <div id={`line-${line.key}`} className={`tline kind-${line.kind} tone-${line.color}${selected ? ' selected' : ''}${focused ? ' target' : ''}${line.streaming ? ' streaming' : ''}`} onClick={onSelect} data-kind={line.kind}>
      <span className="tglyph" aria-hidden="true">{glyphs[line.kind]}</span>
      <div className="tbody">
        <LineMeta line={line} />
        {line.tool?.args && <pre className="targs">{line.tool.args}</pre>}
        <pre className={`ttext${line.tool?.withheld ? ' withheld' : ''}`}>{line.text}</pre>
      </div>
    </div>
  );
}
