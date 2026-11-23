import { glyphs, timeDisplay, type ResetRequest, type TranscriptLine } from '@pi-console/viewmodels';
import { useListNav } from '../app/hooks.ts';
import { focusKey } from './transcript-jump.ts';
import { dayGroups } from './transcript-days.ts';
import { useTranscriptScroll } from './transcript-scroll.ts';
import { TranscriptEmptyState, TranscriptHistoryBar, useTranscriptHistoryPaging } from './transcript-history-bar.tsx';
import type { TranscriptProgress } from '../state/transcript-history.ts';

interface TranscriptProps {
  lines: readonly TranscriptLine[]; focusEntry: string | null; searching: boolean;
  progress?: TranscriptProgress;
  onPage: (direction: 'older' | 'newer') => void; onLive: () => void;
  onResume: () => void; onFollow: (following: boolean) => void;
}

/** Every character is rendered as a React text node (escaped); transcript text is never interpreted as markup. */
export function Transcript({ lines, focusEntry, searching, progress, onPage, onLive, onResume, onFollow }: TranscriptProps) {
  const scroll = useTranscriptScroll(lines, focusEntry, onResume, onFollow);
  const history = useTranscriptHistoryPaging(scroll, progress, searching, onPage);
  const nav = useListNav(lines.map(line => String(line.key)), {
    initial: focusKey(lines, focusEntry), fallback: String(lines.at(-1)?.key), copy: false,
    onMove: key => { scroll.pause(); document.getElementById(`line-${key}`)?.scrollIntoView({ block: 'nearest' }); scroll.remember(); },
  });
  return (
    <div className="transcript-shell">
      <TranscriptHistoryBar scroll={scroll} progress={progress} onPage={history.page} onLive={onLive} />
      <div ref={scroll.pane} onScroll={history.onScroll} className="transcript" role="log" aria-live="off" aria-label="Transcript lines">
      <TranscriptEmptyState empty={lines.length === 0} searching={searching} progress={progress} />
      {dayGroups(lines).map(group => (
        <section key={group.key} className="tday" aria-label={group.date || undefined}>
          {group.date && <h3 className="tday-head">{group.date}</h3>}
          {group.lines.map(line => <Line key={line.key} line={line} selected={nav.selected === String(line.key)} focused={line.id === focusEntry} onSelect={() => { nav.select(String(line.key)); scroll.pause(); }} />)}
        </section>
      ))}
      <div ref={scroll.end} />
      </div>
    </div>
  );
}

/** The compact local clock; the exact source timestamp and the absolute time with its zone are on demand. */
function LineTime({ line }: { line: TranscriptLine }) {
  return <time dateTime={line.at} title={timeDisplay(line.at).absolute}>{line.time}</time>;
}

function LineMeta({ line }: { line: TranscriptLine }) {
  const { tool } = line;
  return (
    <div className="tmeta"><span className="tlabel">{line.label}</span><LineTime line={line} />{line.streaming && <span className="live-dot">streaming</span>}
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
      <div className="reset-rule"><span className="reset-title">{glyphs.reset} {reset ? reset.summary : line.text || 'context reset'}</span><LineTime line={line} /></div>
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
