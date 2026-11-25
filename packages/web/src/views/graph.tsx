import { useEffect, useId, useMemo, type KeyboardEvent } from 'react';
import type { ConsoleStore } from '../client/store.ts';
import type { ConsoleState } from '../state/state.ts';
import { navigate, useStore } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { Panel, SkeletonRows } from '../ui/primitives.tsx';
import { EmptyFor } from '../ui/empty.tsx';
import { edgePath, graphHeight, graphSize as size, labelRows, nodeRadius, placeLabel, placeNodes as place, type NodePlace } from './graph-layout.ts';
import { webGraphModel, type WebGraphGroup, type WebGraphNode } from './graph-model.ts';

/**
 * Canonical lane communication and separate, navigable session spawn relationships. `upTo` is the last-activity cutoff
 * from the time scrubber, which lives in the Messages toolbar (graph-scrubber.tsx).
 */
export function GraphView({ state, upTo = Number.POSITIVE_INFINITY }: { state: ConsoleState; upTo?: number }) {
  const store = useStore();
  useEffect(() => { void store.refresh(); }, [store, state.connection]);
  if (state.graph !== null) return <GraphBody state={state} store={store} upTo={upTo} />;
  return <div className="graph-page">{state.graphError ? <GraphFailure store={store} stale={false} /> : <SkeletonRows label="graph" columns={3} />}</div>;
}

function GraphBody({ state, store, upTo }: { state: ConsoleState; store: ConsoleStore; upTo: number }) {
  const view = useMemo(() => webGraphModel(state, upTo), [state.graph, state.sessions, upTo]);
  return (
    <div className="graph-page">
      {state.graphError && <GraphFailure store={store} stale />}
      <GraphLegend />
      <section aria-label="Lane communication">
        <h2>Lane communication</h2>
        {view.lanes.length === 0 ? <EmptyFor view="graph" />
          : <div className="graph-grid">{view.lanes.map(group => <GroupGraph key={group.id} group={group} />)}</div>}
      </section>
      {view.sessions.length > 0 && <section aria-label="Session relationships">
        <h2>Session relationships</h2>
        <div className="graph-grid">{view.sessions.map(group => <GroupGraph key={group.id} group={group} />)}</div>
      </section>}
    </div>
  );
}

const legendKinds = [['message', 'Messages sent'], ['spawn', 'Started a session'], ['waiting-on', 'Waiting for'], ['barred-by', 'Blocked by']] as const;

function GraphLegend() {
  return (
    <ul className="legend graph-legend" aria-label="Graph legend">
      {legendKinds.map(([kind, text]) => <li key={kind}><svg viewBox="0 0 32 12" aria-hidden="true"><path className={`edge ${kind}`} d="M1 6 H30" /></svg>{text}</li>)}
      <li>Arrows point from the sender or starter to the receiver or target. Thicker lines mean more messages.</li>
    </ul>
  );
}

/** The graph read failed: say so, and offer a retry, instead of looking like an idle fleet. */
function GraphFailure({ store, stale }: { store: ConsoleStore; stale: boolean }) {
  return <div className="toolbar" role="alert"><span className="warn-text">Could not load the graph.{stale && ' Showing the last loaded graph.'}</span><button type="button" className="btn" onClick={() => { void store.refresh(); }}>Retry</button></div>;
}

function GroupGraph({ group }: { group: WebGraphGroup }) {
  const positions = place(group.nodes.map(node => node.id));
  const arrowId = useId();
  const plateId = useId();
  return (
    <Panel title={group.title} aside={group.summary} className="graph-panel">
      <svg className="graph" viewBox={`0 0 ${String(size)} ${String(graphHeight)}`} role="group" aria-label={`Graph for ${group.title}`}>
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="0" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="arrow" /></marker>
          <filter id={plateId} colorInterpolationFilters="sRGB" x="-0.015" y="-0.08" width="1.03" height="1.16"><feFlood className="label-plate" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {group.edges.map(edge => <GraphEdge key={`${edge.kind}:${edge.from}>${edge.to}`} edge={edge} positions={positions} arrowId={arrowId} />)}
        {group.nodes.map(node => <GraphNode key={node.id} node={node} at={positions.get(node.id)} plateId={plateId} />)}
      </svg>
    </Panel>
  );
}

function GraphEdge({ edge, positions, arrowId }: { edge: WebGraphGroup['edges'][number]; positions: Map<string, NodePlace>; arrowId: string }) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return null;
  return <path className={`edge ${edge.kind}`} data-from={edge.from} data-to={edge.to} d={edgePath(from, to)} strokeWidth={edge.thickness * 1.5} markerEnd={`url(#${arrowId})`}><title>{`${edge.kind} ${String(edge.count)}×`}</title></path>;
}

function sessionLink(id: string) {
  const open = () => { navigate(sessionHref(id)); };
  return { role: 'link' as const, tabIndex: 0, onClick: open, onKeyDown: (event: KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter') open(); } };
}

/** The labels sit on a panel-coloured plate (a tight, slightly translucent flood the size of their box) so an edge passing beneath stays faintly visible yet never strikes the text. */
function GraphNode({ node, at, plateId }: { node: WebGraphNode; at: NodePlace | undefined; plateId: string }) {
  if (!at) return null;
  const label = placeLabel(node.label, at, node.identity);
  const name = node.name === null ? null : placeLabel(node.name, at);
  const rows = labelRows(at, name !== null);
  const full = node.name === null ? node.label : `${node.label} · ${node.name}`;
  const interaction = node.sessionId === null ? { role: 'img' as const } : sessionLink(node.sessionId);
  return (
    <g className={`node${node.status ? ` tone-${node.status.color}` : ''}`} transform={`translate(${String(at.x)} ${String(at.y)})`} {...interaction} aria-label={node.status ? `${full}, ${node.status.label}` : full}>
      <title>{full}</title><circle r={nodeRadius} /><text className="glyph" textAnchor="middle" dy="5">{node.status?.glyph ?? '○'}</text>
      <g className="labels" filter={`url(#${plateId})`}><text className="label" textAnchor={label.anchor} dx={label.dx} dy={rows.label}>{label.text}</text>{name && <text className="label name" textAnchor={name.anchor} dx={name.dx} dy={rows.name}>{name.text}</text>}</g>
    </g>
  );
}
