import { laneLabel, markerLegend, pan, timelineViewModel, zoom, type TimeWindow } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { useActions } from '../app/commands.ts';
import { LoadOlder } from './load-older.tsx';
import { EmptyState } from '../ui/primitives.tsx';

const columns = 120;
const laneHeight = 34;
const labelWidth = 170;
const plotWidth = 960;
const x = (column: number): number => labelWidth + column / (columns - 1) * plotWidth;

export function TimelineView({ state }: ViewProps) {
  const [window, setWindow] = useState<TimeWindow | undefined>(undefined);
  const input = { sessions: state.sessions, requests: state.requests, resets: state.resets, questions: state.questions, messages: state.messages, width: columns };
  const view = useMemo(() => timelineViewModel({ ...input, window }), [state.sessions, state.requests, state.resets, state.questions, state.messages, window]);
  useActions(action => {
    const change: Partial<Record<typeof action, (current: TimeWindow) => TimeWindow>> = {
      'time.zoomIn': current => zoom(current, 0.5), 'time.zoomOut': current => zoom(current, 2), 'time.left': current => pan(current, -1), 'time.right': current => pan(current, 1),
    };
    const apply = change[action];
    if (!apply) return false;
    setWindow(apply(window ?? view.window));
    return true;
  });
  const names = new Map(state.sessions.map(session => [session.id, laneLabel(session.repositoryId, session.laneId)]));
  const history = <LoadOlder state={state} collection="resets" shown={state.resets.length} noun="resets" />;
  if (view.lanes.length === 0) return <><EmptyState title="Nothing on the timeline yet" mark="▭">Requests, answers, resets, questions and messages are placed on one time axis as they happen.</EmptyState>{history}</>;
  const height = view.lanes.length * laneHeight + 44;
  return (
    <div className="page timeline">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Zoom and pan">
          <button type="button" onClick={() => { setWindow(pan(window ?? view.window, -1)); }} aria-label="Pan earlier">←</button><button type="button" onClick={() => { setWindow(zoom(window ?? view.window, 2)); }} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => { setWindow(zoom(window ?? view.window, 0.5)); }} aria-label="Zoom in">+</button><button type="button" onClick={() => { setWindow(pan(window ?? view.window, 1)); }} aria-label="Pan later">→</button>
          <button type="button" onClick={() => { setWindow(undefined); }}>Fit</button>
        </div>
        <ul className="legend" aria-label="Legend">{markerLegend.map(item => <li key={item.label} className={`tone-${item.color}`}><span className="legend-glyph" aria-hidden="true">{item.glyph}</span>{item.label}</li>)}</ul>
      </div>
      <svg className="tl" viewBox={`0 0 ${String(labelWidth + plotWidth + 20)} ${String(height)}`} role="img" aria-label="Timeline of requests, answers, resets, questions and messages per session">
        {view.axis.map(tick => <g key={tick.column}><line className="tick" x1={x(tick.column)} x2={x(tick.column)} y1={22} y2={height} /><text className="axis" x={x(tick.column)} y={14} textAnchor="middle">{tick.label}</text></g>)}
        {view.lanes.map((lane, index) => (
          <g key={lane.sessionId} transform={`translate(0 ${String(30 + index * laneHeight)})`} className={`lane tone-${lane.status.color}`}>
            <rect className="lane-bg" x={0} y={0} width={labelWidth + plotWidth + 20} height={laneHeight - 4} rx={6} />
            <text className="lane-label" x={10} y={20}><tspan className="lane-glyph">{lane.status.glyph}</tspan> {names.get(lane.sessionId) ?? lane.label}</text>
            <line className="lane-line" x1={labelWidth} x2={labelWidth + plotWidth} y1={15} y2={15} />
            {lane.cells.map(cell => <text key={cell.markerId} className={`mark tone-${cell.color}`} x={x(cell.column)} y={20} textAnchor="middle"><title>{view.markers.find(marker => marker.id === cell.markerId)?.text ?? ''}</title>{cell.glyph}</text>)}
          </g>))}
      </svg>
      {history}
    </div>
  );
}
