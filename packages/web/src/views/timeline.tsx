import { buildTimeline, zoomLevels, type TimelineRow, type TimelineViewModel } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import { navigate, useConsole, useSelection } from '../app/hooks.ts';
import { useCommands } from '../app/commands.ts';
import { sessionHref } from '../app/routes.ts';
import { EmptyState, Kbd, StatusBadge } from '../ui/primitives.tsx';
import { useScrollIntoView } from '../ui/hooks.ts';

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

function Lane({ row, selected, onSelect }: { row: TimelineRow; selected: boolean; onSelect: () => void }) {
  const ref = useScrollIntoView<HTMLDivElement>(selected);
  return (
    <div ref={ref} className={`lane${selected ? ' selected' : ''}`} onClick={onSelect} onDoubleClick={() => { navigate(sessionHref(row.id)); }}>
      <div className={`lane-label depth-${String(row.depth)}`}>
        <StatusBadge badge={row.badge} compact /><a href={sessionHref(row.id)} className="truncate">{row.label}</a><span className="muted mono small">{row.laneId}</span>
      </div>
      <div className="lane-track">
        {row.spans.map(span => <span key={`${span.kind}${String(span.from)}`} className={`span span-${span.kind}`} style={{ left: pct(span.from), width: pct(span.to - span.from) }} />)}
        {row.markers.filter(marker => marker.at >= 0 && marker.at <= 1).map(marker => (
          <span key={marker.id} className={`marker marker-${marker.kind} tone-${marker.color}`} style={{ left: pct(marker.at) }} title={`${marker.time} ${marker.label}`}>{marker.glyph}</span>
        ))}
      </div>
    </div>
  );
}

function Axis({ model }: { model: TimelineViewModel }) {
  return (
    <div className="axis">
      <div className="lane-label muted small">{model.window.label} window</div>
      <div className="lane-track">{model.ticks.filter(tick => tick.at >= 0 && tick.at <= 1).map(tick => <span key={tick.at} className="tick tnum" style={{ left: pct(tick.at) }}>{tick.label}</span>)}</div>
    </div>
  );
}

export function TimelineView() {
  const state = useConsole();
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [offsetMs, setOffset] = useState(0);
  const [subagents, setSubagents] = useState(true);
  const [messages, setMessages] = useState(false);
  const model = useMemo(() => buildTimeline(state, { zoom, offsetMs, subagents, messages }), [state, zoom, offsetMs, subagents, messages]);
  const [selected, setSelected, move, jump] = useSelection(model.order);
  useCommands(command => {
    switch (command.type) {
      case 'move': move(command.delta); return true;
      case 'top': case 'bottom': jump(command.type); return true;
      case 'open': if (selected) navigate(sessionHref(selected)); return selected !== null;
      case 'zoom': setZoom(Math.max(0, Math.min(zoomLevels.length - 1, model.window.zoom - command.direction))); return true;
      case 'pan': setOffset(value => Math.min(0, value + command.direction * model.window.spanMs / 4)); return true;
      default: return false;
    }
  });
  if (model.empty) return <div className="page"><EmptyState title="Waiting for activity" mark="▭">Axes and legend appear with the first session.</EmptyState></div>;
  return (
    <div className="page timeline">
      <header className="toolbar">
        <div className="seg" role="group" aria-label="Zoom">
          <button type="button" onClick={() => { setZoom(Math.min(zoomLevels.length - 1, model.window.zoom + 1)); }}>− <Kbd>-</Kbd></button>
          <span className="seg-label tnum">{model.window.label}</span>
          <button type="button" onClick={() => { setZoom(Math.max(0, model.window.zoom - 1)); }}>+ <Kbd>+</Kbd></button>
        </div>
        <div className="seg" role="group" aria-label="Pan">
          <button type="button" onClick={() => { setOffset(value => value - model.window.spanMs / 4); }}>◂ <Kbd>h</Kbd></button>
          <button type="button" disabled={offsetMs === 0} onClick={() => { setOffset(0); }}>Now</button>
          <button type="button" disabled={offsetMs === 0} onClick={() => { setOffset(value => Math.min(0, value + model.window.spanMs / 4)); }}>▸ <Kbd>l</Kbd></button>
        </div>
        <label className="check"><input type="checkbox" checked={subagents} onChange={event => { setSubagents(event.target.checked); }} /> Subagents</label>
        <label className="check"><input type="checkbox" checked={messages} onChange={event => { setMessages(event.target.checked); }} /> Messages</label>
        <ul className="legend inline" aria-label="Legend">{model.legend.map(item => <li key={item.label}><span aria-hidden="true">{item.glyph}</span> {item.label}</li>)}</ul>
      </header>
      <div className="lanes" role="group" aria-label="Session timeline">
        <Axis model={model} />
        {model.groups.map(group => (
          <section key={group.id}>
            <h3 className="lane-group">{group.name}</h3>
            {group.rows.map(row => <Lane key={row.id} row={row} selected={row.id === selected} onSelect={() => { setSelected(row.id); }} />)}
          </section>
        ))}
        {offsetMs === 0 && <div className="now-line" aria-hidden="true" />}
      </div>
    </div>
  );
}
