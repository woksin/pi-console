import { buildGraph, graphSize, type GraphEdgeView, type GraphNodeView, type GraphSelection, type GraphViewModel } from '@pi-console/viewmodels';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copyText, navigate, useConsole } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, Kbd, Panel } from '../ui/primitives.tsx';

const windows = [{ label: '15m', ms: 900_000 }, { label: '1h', ms: 3_600_000 }, { label: '6h', ms: 21_600_000 }, { label: '24h', ms: 86_400_000 }] as const;

type Point = { x: number; y: number };

/** Edges bend sideways by pair so A→B and B→A do not overlap; the control point is the same maths for every client. */
function curve(from: Point, to: Point, bend: number): { path: string; mid: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = { x: (from.x + to.x) / 2 - dy / length * bend, y: (from.y + to.y) / 2 + dx / length * bend };
  const mid = { x: (from.x + to.x) / 4 + control.x / 2, y: (from.y + to.y) / 4 + control.y / 2 };
  return { path: `M${String(from.x)} ${String(from.y)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${String(to.x)} ${String(to.y)}`, mid };
}

function Edge({ edge, nodes, onSelect }: { edge: GraphEdgeView; nodes: Map<string, GraphNodeView>; onSelect: () => void }) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return null;
  const { path, mid } = curve(from, to, edge.from < edge.to ? 26 : -26);
  const cls = `edge ${edge.kind}${edge.recent ? ' pulse' : ''}${edge.selected ? ' selected' : ''}`;
  return (
    <g className={cls} onClick={onSelect}>
      <path d={path} className="edge-hit" />
      <path d={path} className="edge-line" style={{ strokeWidth: Math.min(5, 1.2 + Math.log2(edge.count + 1)) }} markerEnd="url(#arrow)" />
      {edge.kind === 'message' && (
        <g transform={`translate(${mid.x.toFixed(1)} ${mid.y.toFixed(1)})`}>
          <circle r={10} className={`edge-badge tone-${edge.delivery.color}`} />
          <text className="edge-glyph" textAnchor="middle" dy="0.35em">{edge.delivery.glyph}</text>
          {edge.count > 1 && <text className="edge-count" x={14} dy="0.35em">{edge.count}</text>}
          <title>{`${edge.count} message${edge.count === 1 ? '' : 's'}, ${edge.delivery.label.toLowerCase()}, ${edge.age} ago${edge.unread > 0 ? `, ${String(edge.unread)} unread` : ''}`}</title>
        </g>
      )}
    </g>
  );
}

function Node({ node, onSelect }: { node: GraphNodeView; onSelect: () => void }) {
  const circumference = 2 * Math.PI * (node.r + 4);
  return (
    <g className={`node tone-${node.badge.color} level-${node.pressure.level}${node.selected ? ' selected' : ''}${node.attention ? ' attention' : ''}${node.hub ? ' hub' : ''}`}
      transform={`translate(${String(node.x)} ${String(node.y)})`} tabIndex={0} role="button" aria-label={`${node.laneId} ${node.badge.label}, context ${node.pressure.label}`}
      onClick={onSelect} onKeyDown={event => { if (event.key === 'Enter') onSelect(); }}>
      <circle r={node.r + 4} className="node-track" />
      <circle r={node.r + 4} className="node-pressure" strokeDasharray={`${(circumference * node.pressure.percent / 100).toFixed(1)} ${circumference.toFixed(1)}`} transform="rotate(-90)" />
      <circle r={node.r} className="node-body" />
      <text className="node-glyph" textAnchor="middle" dy="0.35em">{node.badge.glyph}</text>
      <text className="node-label" y={node.r + 20} textAnchor="middle">{node.label}</text>
      <title>{`${node.laneId} · ${node.repository} · ${node.badge.label} · context ${node.pressure.label}`}</title>
    </g>
  );
}

function Scrubber({ model, until, onChange, windowMs, onWindow }: { model: GraphViewModel; until: number | null; onChange: (value: number | null) => void; windowMs: number; onWindow: (ms: number) => void }) {
  const [playing, setPlaying] = useState(false);
  const position = until ?? model.window.max;
  useEffect(() => {
    if (!playing) return undefined;
    const step = Math.max(1, (model.window.max - model.window.min) / 120);
    const timer = window.setInterval(() => {
      const next = position + step;
      if (next >= model.window.max) { onChange(null); setPlaying(false); } else onChange(next);
    }, 120);
    return () => { window.clearInterval(timer); };
  }, [playing, position, model.window.max, model.window.min, onChange]);
  const clock = new Date(position).toISOString().slice(11, 19);
  return (
    <div className="scrubber">
      <button type="button" className="btn" aria-pressed={playing} onClick={() => { if (!playing && until === null) onChange(model.window.min); setPlaying(value => !value); }}>{playing ? 'Pause' : 'Replay'}</button>
      <input type="range" aria-label="Time scrubber" min={model.window.min} max={model.window.max} step={1000} value={position} onChange={event => { onChange(Number(event.target.value)); }} />
      <span className="tnum mono">{clock}Z</span>
      <button type="button" className="btn" disabled={model.window.live} onClick={() => { onChange(null); setPlaying(false); }}>Live</button>
      <div className="seg" role="group" aria-label="Window">{windows.map(item => <button key={item.label} type="button" aria-pressed={item.ms === windowMs} onClick={() => { onWindow(item.ms); }}>{item.label}</button>)}</div>
    </div>
  );
}

function Detail({ model }: { model: GraphViewModel }) {
  return (
    <Panel title={model.detail.title} aside={`${model.detail.messages.length} shown`}>
      <ul className="msg-list">{model.detail.messages.map(message => (
        <li key={message.id}><span className={`delivery tone-${message.delivery.color}`} title={message.delivery.label}>{message.delivery.glyph}</span>
          <div><div className="muted small"><a href={sessionHref(message.fromId)}>{message.from}</a> → <a href={sessionHref(message.toId)}>{message.to}</a> · {message.age}</div><p>{message.text}</p></div></li>
      ))}</ul>
      {model.detail.messages.length === 0 && <p className="muted">No messages in this window.</p>}
    </Panel>
  );
}

export function GraphView() {
  const state = useConsole();
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [windowMs, setWindowMs] = useState(3_600_000);
  const [until, setUntil] = useState<number | null>(null);
  const [scrubber, setScrubber] = useState(true);
  const model = useMemo(() => buildGraph(state, { windowMs, until, selection }), [state, windowMs, until, selection]);
  const nodes = useMemo(() => new Map(model.nodes.map(node => [node.id, node])), [model]);
  const area = useRef<HTMLDivElement | null>(null);
  useCommands(command => {
    if (command.type === 'scrubber') { setScrubber(value => !value); return true; }
    if (command.type === 'back' && selection) { setSelection(null); return true; }
    if (command.type === 'move' && model.nodes.length > 0) {
      const index = model.nodes.findIndex(node => selection?.kind === 'node' && node.id === selection.id);
      setSelection({ kind: 'node', id: model.nodes[(index + command.delta + model.nodes.length) % model.nodes.length].id });
      return true;
    }
    if (command.type === 'open' && selection?.kind === 'node') { navigate(sessionHref(selection.id)); return true; }
    if (command.type === 'copyId' && selection) { void copyText(selection.id); return true; }
    return false;
  });
  if (model.empty) {
    return <EmptyState title="Waiting for activity" mark="◌">No messages between sessions in this window. Axes and legend appear with the first message.<br />{model.idleCount} sessions idle.</EmptyState>;
  }
  return (
    <div className="graph-page">
      <div className="graph-canvas" ref={area}>
        <svg viewBox={`0 0 ${String(graphSize.width)} ${String(graphSize.height)}`} role="group" aria-label="Communication graph" onClick={event => { if (event.target === event.currentTarget) setSelection(null); }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="arrow-head" /></marker>
          </defs>
          <g>{model.edges.map(edge => <Edge key={edge.id} edge={edge} nodes={nodes} onSelect={() => { setSelection({ kind: 'edge', id: edge.id }); }} />)}</g>
          <g>{model.nodes.map(node => <Node key={node.id} node={node} onSelect={() => { setSelection({ kind: 'node', id: node.id }); }} />)}</g>
        </svg>
        <ul className="legend" aria-label="Legend">{model.legend.map(item => <li key={item.label}><span aria-hidden="true">{item.glyph}</span> {item.label}</li>)}{model.idleCount > 0 && <li className="muted">{model.idleCount} idle sessions hidden</li>}</ul>
        {scrubber && <Scrubber model={model} until={until} onChange={setUntil} windowMs={windowMs} onWindow={setWindowMs} />}
      </div>
      <aside className="graph-side">
        <Detail model={model} />
        <p className="muted small"><Kbd>j</Kbd><Kbd>k</Kbd> select node · <Kbd>↵</Kbd> open session · <Kbd>t</Kbd> scrubber · <Kbd>Esc</Kbd> clear</p>
      </aside>
    </div>
  );
}
