import { useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { clip, type State, type Session } from './model.ts';
import { graphEdges, graphMessages, selectGraph, type GraphSelection } from './signature-model.ts';
import { useMotion } from './motion.ts';
import { status, type Theme } from './theme.ts';

type Point = { x: number; y: number };
type Cell = { glyph: string; color: string; edge?: string };
function pathBetween(from: Point, to: Point, track: number): Point[] {
  const points: Point[] = [];
  const walk = (a: Point, b: Point) => {
    const length = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let n = 0; n <= length; n++) points.push({ x: a.x + Math.sign(b.x - a.x) * n, y: a.y + Math.sign(b.y - a.y) * n });
  };
  walk(from, { x: from.x, y: track });
  walk({ x: from.x, y: track }, { x: to.x, y: track });
  walk({ x: to.x, y: track }, to);
  return points;
}
function positions(sessions: Session[], width: number, height: number) {
  const nodes = new Map<string, Point>();
  const middle = Math.max(6, Math.floor(height * .43));
  const layers = [sessions.filter(s => s.role === 'orchestrator'), sessions.filter(s => s.role !== 'orchestrator' && !s.parentSessionId), sessions.filter(s => s.parentSessionId)];
  layers.forEach((layer, row) => layer.forEach((s, i) => nodes.set(s.id, { x: Math.round((i + 1) * width / (layer.length + 1) - 9), y: [1, middle, height - 4][row] })));
  return nodes;
}
export function Graph({ state, t, width, height, selected, onSelect, onOpen, modal }: { state: State; t: Theme; width: number; height: number; selected: string; onSelect: (id: string) => void; onOpen: (id: string) => void; modal: boolean }) {
  const repositories = [...new Set(state.sessions.map(s => s.repositoryId))];
  const [repository, setRepository] = useState(state.sessions.find(s => s.id === selected)?.repositoryId ?? repositories[0]);
  const [selection, setSelection] = useState<GraphSelection>({ kind: 'node', id: selected });
  const clock = useMotion('graph-clock', 1600, true);
  const entrance = useMotion(repository);
  const narrow = width < 100;
  const sideWidth = narrow ? width : Math.max(32, Math.floor(width * .3));
  const graphWidth = narrow ? width : width - sideWidth - 1;
  const graphHeight = narrow ? Math.floor(height * .61) : height;
  const canvasWidth = graphWidth - 4;
  const canvasHeight = Math.max(10, graphHeight - 6);
  const sessions = state.sessions.filter(s => s.repositoryId === repository);
  const edges = graphEdges(state, sessions);
  const nodes = positions(sessions, canvasWidth, canvasHeight);
  const choices: GraphSelection[] = [...sessions.map(s => ({ kind: 'node' as const, id: s.id })), ...edges.map(e => ({ kind: 'edge' as const, id: e.id }))];
  const messages = graphMessages(state, selection);
  const select = (value: GraphSelection) => { setSelection(value); if (value.kind === 'node') onSelect(value.id); };
  const switchRepository = (delta: number) => {
    const repo = repositories[(repositories.indexOf(repository) + delta + repositories.length) % repositories.length];
    setRepository(repo);
    const session = state.sessions.find(s => s.repositoryId === repo)!;
    select({ kind: 'node', id: session.id });
  };
  useKeyboard(key => {
    if (modal) return;
    if (['j', 'down', 'l', 'right'].includes(key.name)) select(selectGraph(choices, selection, 1));
    if (['k', 'up', 'h', 'left'].includes(key.name)) select(selectGraph(choices, selection, -1));
    if (key.sequence === '[' || key.sequence === ']') switchRepository(key.sequence === ']' ? 1 : -1);
    if (key.name === 'return' && selection.kind === 'node') onOpen(selection.id);
  });
  const cells: Cell[][] = Array.from({ length: canvasHeight }, () => Array.from({ length: canvasWidth }, () => ({ glyph: ' ', color: t.border })));
  const put = (p: Point, glyph: string, color: string, edge?: string) => { if (cells[p.y]?.[p.x]) cells[p.y][p.x] = { glyph, color, edge }; };
  edges.forEach((edge, i) => {
    const a = nodes.get(edge.from)!;
    const b = nodes.get(edge.to)!;
    const from = { x: a.x + 9, y: a.y + 3 };
    const to = { x: b.x + 9, y: b.y - 1 };
    const track = Math.min(to.y, from.y + 1 + i);
    const path = pathBetween(from, to, track);
    const active = selection.kind === 'edge' && selection.id === edge.id;
    const color = active ? t.pink : edge.count > 3 ? t.cyan : t.blue;
    path.forEach((p, index) => {
      const previous = path[Math.max(0, index - 1)];
      put(p, previous.x !== p.x ? edge.count > 3 ? '━' : '─' : '│', color, edge.id);
    });
    put(to, '▼', color, edge.id);
    const label = path[Math.floor(path.length * .5)];
    put(label, String(Math.min(9, edge.count)), t.amber, edge.id);
    const since = Date.now() - (state.pulses.get(edge.id) ?? 0);
    if (since < 1800) {
      const point = path[Math.min(path.length - 1, Math.floor(since / 1800 * path.length))];
      put(point, clock > .5 ? '●' : '◆', t.text, edge.id);
    }
  });
  return <box height={height} flexDirection={narrow ? 'column' : 'row'} gap={1}>
    <box width={graphWidth} height={graphHeight} border borderStyle="rounded" borderColor={t.border} backgroundColor={t.panel} flexDirection="column" paddingX={1}>
      <box height={2} flexDirection="row"><text fg={t.cyan}><strong>NEURAL / MESH</strong><span fg={t.muted}>  {repository.toUpperCase()}</span></text><box flexGrow={1} /><text fg={t.faint}>{sessions.length} nodes · {edges.length} links</text></box>
      <box height={1} flexDirection="row" gap={2}>{repositories.map(repo => <text key={repo} fg={repo === repository ? t.cyan : t.faint} onMouseDown={() => { const delta = repositories.indexOf(repo) - repositories.indexOf(repository); switchRepository(delta); }}>{repo === repository ? '●' : '○'} {repo}</text>)}</box>
      <box width={canvasWidth} height={canvasHeight} marginTop={Math.max(0, Math.round((1 - entrance) * 2))}>
        {cells.map((row, y) => <box key={y} position="absolute" top={y} left={0} height={1} flexDirection="row">{runs(row).map((run, i) => <text key={i} fg={run.color} onMouseDown={() => run.edge && select({ kind: 'edge', id: run.edge })}>{run.glyph}</text>)}</box>)}
        {sessions.map(s => {
          const point = nodes.get(s.id)!;
          const active = selection.kind === 'node' && selection.id === s.id;
          return <box key={s.id} position="absolute" left={point.x} top={point.y} width={18} height={3} border borderStyle="rounded" borderColor={active ? t.cyan : status(t, s.status)[1]} backgroundColor={active ? t.select : t.raised} flexDirection="column" onMouseDown={() => select({ kind: 'node', id: s.id })}>
            <text fg={active ? t.text : t.muted}>{active ? '▸' : ' '} {s.laneId} <span fg={status(t, s.status)[1]}>{status(t, s.status)[0]} {clip(s.status, 8)}</span></text>
          </box>;
        })}
        <text position="absolute" top={0} left={0} fg={t.faint}>01 / ORCHESTRATOR</text>
        <text position="absolute" top={Math.max(5, Math.floor(canvasHeight * .43)) - 1} left={0} fg={t.faint}>02 / LANES</text>
        <text position="absolute" top={canvasHeight - 5} left={0} fg={t.faint}>03 / SUBAGENTS</text>
      </box>
      <text height={1} fg={t.faint}>● live packet · brightness = volume · j/k nodes + edges · [ ] repository</text>
    </box>
    <box width={sideWidth} height={narrow ? height - graphHeight - 1 : height} border borderStyle="rounded" borderColor={selection.kind === 'edge' ? t.pink : t.cyan} backgroundColor={t.panel} paddingX={1} flexDirection="column" title={selection.kind === 'edge' ? ' CONVERSATION ' : ' NODE / RECENT MESSAGES '}>
      <text height={1} fg={t.text}><strong>{selection.kind === 'node' ? state.sessions.find(s => s.id === selection.id)?.name : selection.id.replace('~', ' ↔ ')}</strong></text>
      <text height={1} fg={t.faint}>{messages.length} retained messages · audit, not delivery</text>
      <scrollbox flexGrow={1}>
        {messages.map(m => <box key={m.id} flexDirection="column" marginTop={1}>
          <text fg={t.cyan}>{m.fromSessionId} → {m.toSessionId}<span fg={t.faint}>  {m.sentAt.slice(11, 19)}</span></text>
          <text fg={t.text}>{clip(m.text, sideWidth * 2 - 12)}</text>
          <text fg={t.violet}>{m.status} <span fg={t.faint}>/ {m.id}</span></text>
        </box>)}
        {!messages.length && <text fg={t.muted}>No messages recorded for this selection.</text>}
      </scrollbox>
      <text height={1} fg={t.amber}>i intervene · ↵ open node</text>
    </box>
  </box>;
}
function runs(row: Cell[]) {
  const result: Cell[] = [];
  for (const cell of row) {
    const last = result.at(-1);
    if (last && last.color === cell.color && last.edge === cell.edge) last.glyph += cell.glyph;
    else result.push({ ...cell });
  }
  return result;
}
