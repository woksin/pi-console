import { columnOf, displayWidth, fitSessionLabel, repositoryLabel, sessionLabels, markerLegend, pan, timelineTicks, timelineViewModel, zoom, type TimeWindow } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import type { ViewProps } from '../app/view.tsx';
import { useActions } from '../app/commands.ts';
import { useListNav } from '../app/hooks.ts';
import { TimelineHistory } from './timeline-history.tsx';
import { EmptyFor } from '../ui/empty.tsx';
import { SkeletonRows } from '../ui/primitives.tsx';
import { groupHeight, labelCellsFor, labelColumnWidth, laneHeight, timelineGroups, withoutRepositoryPrefix } from './timeline-groups.ts';
import { indexMarkers } from './timeline-markers.ts';
import { TimelineMarker } from './timeline-marker.tsx';
import { TimelineDetail } from './timeline-detail.tsx';

const columns = 120;
const plotWidth = 960;

export function TimelineView({ state, now }: ViewProps) {
  const [window, setWindow] = useState<TimeWindow | undefined>(undefined);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const input = { sessions: state.sessions, requests: state.requests, resets: state.resets, questions: state.questions, messages: state.messages, width: columns };
  const view = useMemo(() => timelineViewModel({ ...input, window }), [state.sessions, state.requests, state.resets, state.questions, state.messages, window]);
  const markersById = useMemo(() => indexMarkers(view.markers), [view.markers]);
  const selectedMarker = selectedMarkerId === null ? undefined : markersById.get(selectedMarkerId);
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
  const names = new Map(state.sessions.map(session => [session.id, sessionLabels(session).timeline]));
  // In its repository group the name drops the repeated repository; the column grows to the longest label so the lane id stays visible.
  const shown = new Map(state.sessions.map(session => [session.id, withoutRepositoryPrefix(sessionLabels(session), repositoryLabel(session.repositoryId))]));
  const labelWidth = labelColumnWidth([...shown.values()].map(label => displayWidth(fitSessionLabel(label, Number.MAX_SAFE_INTEGER))));
  const labelCells = labelCellsFor(labelWidth);
  const labels = new Map([...shown].map(([id, label]) => [id, fitSessionLabel(label, labelCells)]));
  const x = (column: number): number => labelWidth + column / (columns - 1) * plotWidth;
  if (!state.snapshotLoaded) return <div className="page"><SkeletonRows label="timeline" columns={4} /></div>;
  const history = <TimelineHistory state={state} />;
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
      <svg className="tl" viewBox={`0 0 ${String(labelWidth + plotWidth + 20)} ${String(height)}`} role="group" aria-label="Timeline of requests, answers, resets, questions and messages per session">
        {ticks.map(tick => <g key={tick.at}><line className="tick" x1={x(tick.column)} x2={x(tick.column)} y1={22} y2={height} /><text className="axis" x={x(tick.column)} y={14} textAnchor="middle">{tick.label}</text></g>)}
        {groups.map(group => <g key={group.repositoryId} className="timeline-group" aria-label={repositoryLabel(group.repositoryId)} transform={`translate(0 ${String(group.top)})`}>
          <rect className="repository-bg" x={0} y={0} width={labelWidth + plotWidth + 20} height={groupHeight - 4} />
          <text className="repository-label" x={10} y={17}>{repositoryLabel(group.repositoryId)}<title>{`${group.repositoryId} · ${String(group.lanes.length)} sessions`}</title></text>
          {group.lanes.map((lane, index) => (
          <g key={lane.sessionId} transform={`translate(0 ${String(groupHeight + index * laneHeight)})`} className={`lane tone-${lane.status.color}${rows.selected === lane.sessionId ? ' selected' : ''}`} onClick={() => { rows.select(lane.sessionId); }}>
            <rect className="lane-bg" x={0} y={0} width={labelWidth + plotWidth + 20} height={laneHeight - 4} rx={6} />
            <text className="lane-label" x={10} y={20}><title>{names.get(lane.sessionId) ?? lane.label}</title><tspan className="lane-glyph">{lane.status.glyph}</tspan> {labels.get(lane.sessionId) ?? lane.label}</text>
            <line className="lane-line" x1={labelWidth} x2={labelWidth + plotWidth} y1={15} y2={15} />
            {lane.cells.map(cell => {
              const marker = markersById.get(cell.markerId);
              return marker && <TimelineMarker key={cell.markerId} marker={marker} lane={names.get(lane.sessionId) ?? lane.label} x={x(cell.column)} cellWidth={plotWidth / (columns - 1)} selected={selectedMarkerId === marker.id} onSelect={() => { setSelectedMarkerId(marker.id); rows.select(lane.sessionId); }} />;
            })}
          </g>))}
        </g>)}
        {nowColumn >= 0 && nowColumn < columns && <g className="now-line" aria-label="Now"><line x1={x(nowColumn)} x2={x(nowColumn)} y1={22} y2={height} /><text x={x(nowColumn)} y={27} textAnchor="end">now</text></g>}
      </svg>
      {history}
      {selectedMarker && <TimelineDetail marker={selectedMarker} lane={names.get(selectedMarker.sessionId) ?? selectedMarker.sessionId} />}
    </div>
  );
}
