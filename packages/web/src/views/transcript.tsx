import type { TranscriptLine } from '@pi-console/viewmodels';
import { useListNav } from '../app/hooks.ts';
import { useTranscriptScroll } from './transcript-scroll.ts';
import { EmptyState } from '../ui/primitives.tsx';

interface TranscriptProps { lines: readonly TranscriptLine[]; focusEntry: string | null; searching: boolean }

/** Every character is rendered as a React text node (escaped); transcript text is never interpreted as markup. */
export function Transcript({ lines, focusEntry, searching }: TranscriptProps) {
  const scroll = useTranscriptScroll(lines, focusEntry);
  const nav = useListNav(lines.map(line => line.id), { initial: focusEntry });
  if (lines.length === 0) return <EmptyState title={searching ? 'No lines match' : 'No transcript yet'} mark="…">{searching ? 'Clear the search to see the whole transcript.' : 'Lines stream in here as the agent works.'}</EmptyState>;
  return (
    <div ref={scroll.pane} onScroll={scroll.onScroll} className="transcript" role="log" aria-live="off" aria-label="Transcript lines">
      <button type="button" className="btn follow" aria-pressed={scroll.follow} onClick={scroll.toggleFollow}>{scroll.follow ? '● Following' : '○ Follow tail'} <kbd className="kbd">f</kbd></button>
      {lines.map(line => <Line key={line.id} line={line} selected={nav.selected === line.id} focused={line.id === focusEntry} onSelect={() => { nav.select(line.id); scroll.pause(); }} />)}
      <div ref={scroll.end} />
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

function Line({ line, selected, focused, onSelect }: { line: TranscriptLine; selected: boolean; focused: boolean; onSelect: () => void }) {
  if (line.kind === 'reset') return <div id={`line-${line.id}`} className="reset-marker" role="separator"><span>┃ {line.text || 'context reset'}</span><time>{line.time}</time></div>;
  return (
    <div id={`line-${line.id}`} className={`tline kind-${line.kind} tone-${line.color}${selected ? ' selected' : ''}${focused ? ' target' : ''}${line.streaming ? ' streaming' : ''}`} onClick={onSelect} data-kind={line.kind}>
      <span className="tglyph" aria-hidden="true">{line.glyph}</span>
      <div className="tbody">
        <LineMeta line={line} />
        {line.tool && line.tool.args && <pre className="targs">{line.tool.args}</pre>}
        <pre className={`ttext${line.tool?.withheld ? ' withheld' : ''}`}>{line.text}</pre>
      </div>
    </div>
  );
}
