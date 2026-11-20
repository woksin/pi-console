import type { TranscriptLine } from '@pi-console/viewmodels';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useActions } from '../app/commands.ts';
import { isTyping } from '../app/keys.ts';
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
  /** Reading back up is a deliberate act: any user scroll away from the tail pauses following, so the viewport stays anchored where the reader put it. */
  useEffect(() => {
    const pause = (): void => { setFollow(false); };
    const onWheel = (event: WheelEvent): void => { if (event.deltaY < 0) pause(); };
    const onKey = (event: KeyboardEvent): void => { if (!isTyping(event.target) && ['PageUp', 'ArrowUp', 'Home', 'k', 'g'].includes(event.key)) pause(); };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', pause, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('touchmove', pause); window.removeEventListener('keydown', onKey); };
  }, []);
  const pane = useRef<HTMLDivElement>(null);
  const anchor = useRef<Anchor | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  /** While paused, the viewport is pinned to a line id (never an index or scroll offset): eviction at the retention cap or a history merge above it moves the content, and the pinned line is brought back to the same screen position. */
  useLayoutEffect(() => {
    if (follow || !pane.current) return;
    restore(pane.current, anchor.current, lines);
    anchor.current = capture(pane.current);
  }, [follow, lines]);
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    const target = focusEntry && jumped.current !== focusEntry ? document.getElementById(`line-${focusEntry}`) : null;
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    jumped.current = focusEntry;
    if (pane.current) anchor.current = capture(pane.current);
  }, [focusEntry, lines.length]);
  if (lines.length === 0) return <EmptyState title={searching ? 'No lines match' : 'No transcript yet'} mark="…">{searching ? 'Clear the search to see the whole transcript.' : 'Lines stream in here as the agent works.'}</EmptyState>;
  return (
    <div ref={pane} onScroll={() => { if (!followRef.current && pane.current) anchor.current = capture(pane.current); }} className="transcript" role="log" aria-live="off" aria-label="Transcript lines">
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

interface Anchor { id: string; top: number }

const lineId = (element: Element): string => element.id.slice('line-'.length);

/** The first line at or below the top edge of the pane, with its offset from that edge. */
function capture(pane: HTMLElement): Anchor | null {
  const edge = pane.getBoundingClientRect().top;
  for (const element of pane.querySelectorAll('[id^="line-"]')) {
    const top = element.getBoundingClientRect().top - edge;
    if (top + element.getBoundingClientRect().height > 0) return { id: lineId(element), top };
  }
  return null;
}

/** Puts the anchored line back at its captured offset; if it was evicted, the oldest surviving line is the nearest honest position. */
function restore(pane: HTMLElement, anchor: Anchor | null, lines: readonly TranscriptLine[]): void {
  if (!anchor) return;
  const element = document.getElementById(`line-${anchor.id}`) ?? (lines.length > 0 ? document.getElementById(`line-${lines[0].id}`) : null);
  if (!element) return;
  const top = element.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  const delta = top - (element.id === `line-${anchor.id}` ? anchor.top : 0);
  if (Math.abs(delta) > 0.5) pane.scrollTop += delta;
}
