import { useEffect, useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { clean, clip, type Entry, type Session, type State } from './model.ts';
import { status, type Theme } from './theme.ts';
import { Context, Label, Panel, Requests } from './widgets.tsx';
import { blend, useMotion } from './motion.ts';

export type Line = { id: string; text: string; color: string; expandable: boolean };
function presentation(entry: Entry, state: State, t: Theme) {
  const styles: Record<string, [string, string]> = {
    user: ['▸ origin not verified', t.blue], thinking: ['◇ thinking', t.faint],
    'tool.call': ['⚙ tool', t.cyan], 'tool.result': ['↳ result · received', t.green],
    diff: ['± patch / src/queue.ts', t.muted],
  };
  const [label, color] = styles[entry.kind] ?? ['◂ assistant', t.text];
  const text = clean(entry.text);
  if (entry.kind !== 'reset') return { label, color, text };
  const reset = state.resets.find(r => r.id === entry.resetId);
  return {
    label: `── ${reset?.kind.toUpperCase() ?? 'RESET'} / ${entry.resetId ?? 'boundary'} ──`, color: t.pink,
    text: `carried: ${reset?.carriedRequestIds.join(', ') ?? 'not recorded'} · interrupted: ${reset?.interruptedRequestIds.join(', ') ?? 'not recorded'}\n${text}`,
  };
}
function bodyLines(entry: Entry, body: { text: string; color: string; collapsed: boolean }, t: Theme, width: number): Line[] {
  const lines: Line[] = [];
  for (const paragraph of body.text.split('\n')) {
    const chars = [...paragraph];
    const bodyWidth = Math.max(8, width - 3);
    const diffColor = paragraph.startsWith('+') ? t.green : paragraph.startsWith('-') ? t.red : t.faint;
    for (let start = 0; start < Math.max(1, chars.length); start += bodyWidth) {
      lines.push({ id: entry.id, text: `   ${chars.slice(start, start + bodyWidth).join('')}`, color: entry.kind === 'diff' ? diffColor : body.color, expandable: body.collapsed });
    }
  }
  return lines;
}
export function timeline(entries: Entry[], state: State, t: Theme, width: number, expanded: Set<string>, search = '') {
  const lines: Line[] = [];
  for (const entry of entries) {
    const collapsed = ['thinking', 'tool.call', 'tool.result'].includes(entry.kind);
    const time = entry.at.slice(11, 19);
    const { label, color, text } = presentation(entry, state, t);
    if (search && !`${label} ${text}`.toLowerCase().includes(search.toLowerCase())) continue;
    const open = expanded.has(entry.id);
    lines.push({ id: entry.id, text: clip(`${time}  ${label}${collapsed ? open ? ' ▾' : ' ▸' : ''}${entry.kind === 'assistant.delta' ? ' · streaming' : ''}`, width), color, expandable: collapsed });
    if (collapsed && !open) {
      lines[lines.length - 1].text = clip(`${time}  ${label} ▸  ${text.replace(/\n/g, ' ')}`, width);
      continue;
    }
    lines.push(...bodyLines(entry, { text, color, collapsed }, t, width));
    lines.push({ id: entry.id, text: '', color, expandable: false });
  }
  return lines;
}
export function Detail({ state, session, t, width, height, focus, search, modal, at }: { state: State; session: Session; t: Theme; width: number; height: number; focus: number; search: string; modal: boolean; at?: number }) {
  const [follow, setFollow] = useState(true);
  const [anchor, setAnchor] = useState(0);
  const [frozen, setFrozen] = useState<Entry[]>([]);
  const [seenCursor, setSeenCursor] = useState(0);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [block, setBlock] = useState('');
  const highlight = useMotion(block, 450);
  const narrow = width < 100;
  const railWidth = narrow ? width : Math.max(35, Math.floor(width * .29));
  const transcriptWidth = narrow ? width : width - railWidth - 1;
  const viewHeight = Math.max(3, (narrow ? Math.floor(height * .65) : height) - 5);
  const liveEntries = state.entries.get(session.id) ?? [];
  const entries = follow ? liveEntries : frozen;
  const lastCursor = liveEntries.at(-1)?.cursor ?? 0;
  const reset = state.resets.findLast(r => r.sessionId === session.id);
  const lines = useMemo(() => timeline(follow && !search ? entries.slice(-120) : entries, state, t, transcriptWidth - 6, expanded, search), [state.revision, session.id, t, transcriptWidth, expanded, search, follow, frozen]);
  const bottom = Math.max(0, lines.length - viewHeight);
  const start = follow ? bottom : Math.min(anchor, bottom);
  const move = (delta: number) => {
    if (follow) { setSeenCursor(lastCursor); setFrozen([...liveEntries]); }
    const current = follow && !search ? Math.max(0, timeline(entries, state, t, transcriptWidth - 6, expanded).length - viewHeight) : start;
    setAnchor(Math.max(0, current + delta));
    setFollow(false);
  };
  const toggle = (id: string) => setExpanded(old => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  useEffect(() => { setFollow(true); setAnchor(0); setBlock(''); }, [session.id, search]);
  useEffect(() => {
    if (at === undefined || !liveEntries.length) return;
    const nearest = liveEntries.reduce((a, b) => Math.abs(Date.parse(a.at) - at) <= Math.abs(Date.parse(b.at) - at) ? a : b);
    const projected = timeline(liveEntries, state, t, transcriptWidth - 6, expanded, search);
    setFrozen([...liveEntries]); setFollow(false); setSeenCursor(lastCursor);
    setAnchor(Math.max(0, projected.findIndex(line => line.id === nearest.id)));
  }, [at, session.id]);
  const moveBlock = (delta: number) => {
    const projected = timeline(entries, state, t, transcriptWidth - 6, expanded, search);
    const blocks = [...new Set(projected.filter(line => line.expandable).map(line => line.id))];
    const current = blocks.indexOf(block || lines.slice(start, start + viewHeight).find(line => line.expandable)?.id || '');
    const id = blocks[Math.max(0, Math.min(blocks.length - 1, current + delta))];
    if (!id) return;
    if (follow) { setFrozen([...liveEntries]); setSeenCursor(lastCursor); }
    setFollow(false); setBlock(id);
    setAnchor(Math.max(0, projected.findIndex(line => line.id === id) - 1));
  };
  useKeyboard(key => {
    if (modal || focus !== 0) return;
    if (['up', 'k', 'pageup'].includes(key.name)) move(key.name === 'pageup' ? -viewHeight : -3);
    if (['down', 'j', 'pagedown'].includes(key.name)) move(key.name === 'pagedown' ? viewHeight : 3);
    if (key.name === 'f' || key.sequence === 'G' || key.name === 'end') setFollow(true);
    if (key.sequence === '[' || key.sequence === ']') moveBlock(key.sequence === ']' ? 1 : -1);
    if (key.name === 'home') { setFrozen([...liveEntries]); setFollow(false); setAnchor(0); setSeenCursor(lastCursor); }
    if (key.name === 'return' || key.name === 'space') {
      const line = lines.find(l => l.id === block && l.expandable) ?? lines.slice(start, start + viewHeight).find(l => l.expandable);
      if (line) { setBlock(line.id); toggle(line.id); }
    }
  });
  return <box flexDirection={narrow ? 'column' : 'row'} gap={1} height={height} flexShrink={0}>
    <box width={transcriptWidth} height={narrow ? Math.floor(height * .65) : height} flexDirection="column" onMouseScroll={event => move(event.scroll?.direction === 'up' ? -3 : 3)}>
      <Panel title={`TRANSCRIPT / ${session.laneId} · ${session.id}`} t={t} active={focus === 0} grow={1}>
        <text height={1} fg={t.faint}>{entries.length} retained entries · {search ? `matching “${search}”` : '[ ] block cursor · Enter / click disclose'}</text>
        <text height={1} fg={t.pink}>{reset ? clip(`── ${reset.kind.toUpperCase()} ${reset.id} · carried ${reset.carriedRequestIds.join(', ')} · / ${reset.interruptedRequestIds.join(', ')} interrupted ──`, transcriptWidth - 6) : '── no reset boundary recorded ──'}</text>
        {lines.slice(start, start + viewHeight).map((line, i) => <box key={`${start + i}`} height={1} flexShrink={0} backgroundColor={line.id === block ? blend(t.raised, t.select, highlight) : line.color === t.pink ? t.raised : undefined} onMouseDown={() => { if (line.expandable) { setBlock(line.id); toggle(line.id); } }}>
          <text height={1} fg={line.color}>{line.text}</text>
        </box>)}
        {!lines.length && <text fg={t.muted}>No transcript recorded for this session. The fixture records s2 only.</text>}
        <box flexGrow={1} />
        <box height={1} onMouseDown={() => setFollow(true)}><text height={1} fg={follow ? t.cyan : t.amber}>{follow ? '● LIVE · following tail' : `Ⅱ PAUSED  ↓ ${Math.max(0, lastCursor - seenCursor)} new · f to follow`}</text></box>
      </Panel>
    </box>
    <box width={railWidth} height={narrow ? height - Math.floor(height * .65) - 1 : height}>
      <Panel title="SESSION / NEVER-LOST LOG" t={t} active={focus === 1} grow={1}>
        <scrollbox flexGrow={1} focused={focus === 1 && !modal}>
          <Label color={t.text}>{session.name}</Label>
          <text height={1} fg={status(t, session.status)[1]}>{status(t, session.status)[0]} {session.status} · {session.role}</text>
          <text height={1} fg={t.faint}>{session.branch}</text>
          <Context session={session} t={t} />
          <box height={1} />
          <Requests state={state} session={session} t={t} width={railWidth} />
          <box height={1} />
          <Label color={t.muted}>SUBAGENTS</Label>
          {state.sessions.filter(s => s.parentSessionId === session.id).map(s => <text key={s.id} height={1} fg={status(t, s.status)[1]}>└ {status(t, s.status)[0]} {s.name} · {s.status}</text>)}
          <box height={1} />
          <Label color={t.muted}>JOBS / PHASES</Label>
          {state.jobs.filter(j => j.sessionId === session.id).map(j => <text key={j.id} height={2} fg={status(t, j.status)[1]}>◇ {j.name} · {j.status}{j.exitCode !== null ? ` · exit ${j.exitCode}` : ''}</text>)}
          <text height={1} fg={t.faint}>Read-only mock · no commands delivered</text>
        </scrollbox>
      </Panel>
    </box>
  </box>;
}
