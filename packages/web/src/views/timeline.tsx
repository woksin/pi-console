import { columnOf, laneLabel, markerLegend, pan, timelineTicks, timelineViewModel, zoom, type TimeWindow } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { useActions } from '../app/commands.ts';
import { useListNav } from '../app/hooks.ts';
import { LoadOlder } from './load-older.tsx';
import { EmptyFor } from '../ui/empty.tsx';
import { groupHeight, laneHeight, timelineGroups } from './timeline-groups.ts';
import { indexMarkers } from './timeline-markers.ts';

const columns = 120;
const labelWidth = 170;
const plotWidth = 960;
const x = (column: number): number => labelWidth + column / (columns - 1) * plotWidth;

export function TimelineView({ state, now }: ViewProps) {
  const [window, setWindow] = useState<TimeWindow | undefined>(undefined);
  const input = { sessions: state.sessions, requests: state.requests, resets: state.resets, questions: state.questions, messages: state.messages, width: columns };
  const view = useMemo(() => timelineViewModel({ ...input, window }), [state.sessions, state.requests, state.resets, state.questions, state.messages, window]);
  const markersById = useMemo(() => indexMarkers(view.markers), [view.markers]);
  useActions(action => {
    const change: Partial<Record<typeof action, (current: TimeWindow) => TimeWindow>> = {
      'time.zoomIn': current => zoom(current, 0.5), 'time.zoomOut': current => zoom(current, 2), 'time.left': current => pan(current, -1), 'time.right': current => pan(current, 1),
    };
    const apply = change[action];
    if (!apply) return false;
    setWindow(apply(window ?? view.window));
    return true;
  });
  const groups = timelineGroups(view.lanes, state.sessions);
  const rows = useListNav(groups.flatMap(group => group.lanes.map(lane => lane.sessionId)));
  const ticks = timelineTicks(view.window, columns);
  const nowColumn = columnOf(now, view.window, columns);
  const names = new Map(state.sessions.map(session => [session.id, laneLabel(session.repositoryId, session.laneId)]));
  const history = <LoadOlder state={state} collection="resets" shown={state.resets.length} noun="resets" />;
  if (view.lanes.length === 0) return <><EmptyFor view="timeline" />{history}</>;
  const height = view.lanes.length * laneHeight + groups.length * groupHeight + 44;
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
        {ticks.map(tick => <g key={tick.at}><line className="tick" x1={x(tick.column)} x2={x(tick.column)} y1={22} y2={height} /><text className="axis" x={x(tick.column)} y={14} textAnchor="middle">{tick.label}</text></g>)}
        {groups.map(group => <g key={group.repositoryId} className="timeline-group" aria-label={group.repositoryId} transform={`translate(0 ${String(group.top)})`}>
          <rect className="repository-bg" x={0} y={0} width={labelWidth + plotWidth + 20} height={groupHeight - 4} />
          <text className="repository-label" x={10} y={17}>{group.repositoryId}<title>{group.repositoryId} · {group.lanes.length} sessions</title></text>
          {group.lanes.map((lane, index) => (
          <g key={lane.sessionId} transform={`translate(0 ${String(groupHeight + index * laneHeight)})`} className={`lane tone-${lane.status.color}${rows.selected === lane.sessionId ? ' selected' : ''}`} onClick={() => { rows.select(lane.sessionId); }}>
            <rect className="lane-bg" x={0} y={0} width={labelWidth + plotWidth + 20} height={laneHeight - 4} rx={6} />
            <text className="lane-label" x={10} y={20}><tspan className="lane-glyph">{lane.status.glyph}</tspan> {names.get(lane.sessionId) ?? lane.label}</text>
            <line className="lane-line" x1={labelWidth} x2={labelWidth + plotWidth} y1={15} y2={15} />
            {lane.cells.map(cell => <text key={cell.markerId} className={`mark tone-${cell.color}`} x={x(cell.column)} y={20} textAnchor="middle"><title>{markersById.get(cell.markerId)?.text ?? ''}</title>{cell.glyph}</text>)}
          </g>))}
        </g>)}
        {nowColumn >= 0 && nowColumn < columns && <g className="now-line" aria-label="Now"><line x1={x(nowColumn)} x2={x(nowColumn)} y1={22} y2={height} /><text x={x(nowColumn)} y={27} textAnchor="end">now</text></g>}
      </svg>
      {history}
    </div>
  );
}
