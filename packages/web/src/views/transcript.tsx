import type { TranscriptLine } from '@pi-console/viewmodels';
import { useEffect, useRef, useState } from 'react';
import { useActions } from '../app/commands.ts';
import { useListNav } from '../app/hooks.ts';
import { EmptyState } from '../ui/primitives.tsx';

interface TranscriptProps { lines: readonly TranscriptLine[]; focusEntry: string | null; searching: boolean }

/** Every character is rendered as a React text node (escaped); transcript text is never interpreted as markup. */
export function Transcript({ lines, focusEntry, searching }: TranscriptProps) {
  const [follow, setFollow] = useState(focusEntry === null);
  const ids = lines.map(line => line.id);
  const nav = useListNav(ids, { initial: focusEntry });
  const end = useRef<HTMLDivElement>(null);
  useActions(action => { if (action === 'follow.toggle') { setFollow(value => !value); return true; } return false; });
  const last = lines.at(-1)?.id;
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: 'end' }); }, [follow, last, lines.length]);
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const target = focusEntry && jumped.current !== focusEntry ? document.getElementById(`line-${focusEntry}`) : null;
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    jumped.current = focusEntry;
  }, [focusEntry, lines.length]);
  if (lines.length === 0) return <EmptyState title={searching ? 'No lines match' : 'No transcript yet'} mark="…">{searching ? 'Clear the search to see the whole transcript.' : 'Lines stream in here as the agent works.'}</EmptyState>;
  return (
    <div className="transcript" role="log" aria-live="off" aria-label="Transcript lines">
      <button type="button" className="btn follow" aria-pressed={follow} onClick={() => { setFollow(value => !value); }}>{follow ? '● Following' : '○ Follow tail'} <kbd className="kbd">f</kbd></button>
      {lines.map(line => <Line key={line.id} line={line} selected={nav.selected === line.id} focused={line.id === focusEntry} onSelect={() => { nav.select(line.id); setFollow(false); }} />)}
      <div ref={end} />
    </div>
  );
}

function Line({ line, selected, focused, onSelect }: { line: TranscriptLine; selected: boolean; focused: boolean; onSelect: () => void }) {
  if (line.kind === 'reset') return <div id={`line-${line.id}`} className="reset-marker" role="separator"><span>┃ {line.text || 'context reset'}</span><time>{line.time}</time></div>;
  return (
    <div id={`line-${line.id}`} className={`tline kind-${line.kind} tone-${line.color}${selected ? ' selected' : ''}${focused ? ' target' : ''}${line.streaming ? ' streaming' : ''}`} onClick={onSelect} data-kind={line.kind}>
      <span className="tglyph" aria-hidden="true">{line.glyph}</span>
      <div className="tbody">
        <div className="tmeta"><span className="tlabel">{line.label}</span><time>{line.time}</time>{line.streaming && <span className="live-dot">streaming</span>}{line.tool && <span className="tool-name mono">{line.tool.name}</span>}{line.tool?.truncated && <span className="faint">truncated</span>}</div>
        {line.tool && line.tool.args && <pre className="targs">{line.tool.args}</pre>}
        <pre className={`ttext${line.tool?.withheld ? ' withheld' : ''}`}>{line.text}</pre>
      </div>
    </div>
  );
}
