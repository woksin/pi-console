import { laneLabel, graphViewModel, type GraphGroup } from '@pi-console/viewmodels';
import { useMemo, useState } from 'react';
import type { ConsoleState } from '../state/state.ts';
import { useActions } from '../app/commands.ts';
import { navigate } from '../app/hooks.ts';
import { sessionHref } from '../app/routes.ts';
import { Panel } from '../ui/primitives.tsx';
import { EmptyFor } from '../ui/empty.tsx';

const size = 360;
const radius = 130;

function place(group: GraphGroup): Map<string, { x: number; y: number }> {
  const centre = size / 2;
  return new Map(group.nodes.map((node, index) => {
    const angle = (index / Math.max(1, group.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return [node.sessionId, { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius }];
  }));
}

/** Communication graph per repository, drawn from the shared graph model; a time scrubber replays who talked to whom up to a moment. */
export function GraphView({ state }: { state: ConsoleState }) {
  const times = useMemo(() => state.messages.map(message => Date.parse(message.sentAt)).sort((a, b) => a - b), [state.messages]);
  const [scrub, setScrub] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  useActions(action => { if (action !== 'time.scrub') return false; setScrubbing(value => !value); setScrub(null); return true; });
  const upTo = scrubbing ? (scrub ?? times.at(-1) ?? 0) : Number.POSITIVE_INFINITY;
  const view = useMemo(() => graphViewModel({ sessions: state.sessions, messages: state.messages.filter(message => Date.parse(message.sentAt) <= upTo) }), [state.sessions, state.messages, upTo]);
  return (
    <div className="graph-page">
      <div className="toolbar">
        <button type="button" className="btn" aria-pressed={scrubbing} onClick={() => { setScrubbing(value => !value); setScrub(null); }}>Time scrubber <kbd className="kbd">t</kbd></button>
        {scrubbing && times.length > 0 && <>
          <input type="range" className="scrubber" aria-label="Time scrubber" min={times[0]} max={times.at(-1)} step={1000} value={Math.min(upTo, times.at(-1) ?? 0)} onChange={event => { setScrub(Number(event.target.value)); }} />
          <time className="mono muted">{new Date(upTo).toISOString().slice(11, 19)}</time></>}
      </div>
      <ul className="legend graph-legend" aria-label="Graph legend">
        <li><svg viewBox="0 0 32 12" aria-hidden="true"><path className="edge message" d="M1 6 H30" /></svg>Message →</li>
        <li><svg viewBox="0 0 32 12" aria-hidden="true"><path className="edge spawn" d="M1 6 H30" /></svg>Spawn →</li>
        <li>Thicker edges = more messages</li><li>Nodes show session status</li>
      </ul>
      {view.groups.length === 0 ? <EmptyFor view="graph" />
        : <div className="graph-grid">{view.groups.map(group => <GroupGraph key={group.repositoryId} group={group} />)}</div>}
    </div>
  );
}

function GroupGraph({ group }: { group: GraphGroup }) {
  const positions = place(group);
  return (
    <Panel title={group.repositoryId} aside={`${String(group.messages)} messages`} className="graph-panel">
      <svg className="graph" viewBox={`0 0 ${String(size)} ${String(size)}`} role="group" aria-label={`Communication graph for ${group.repositoryId}`}>
        <defs><marker id={`arrow-${group.repositoryId}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="arrow" /></marker></defs>
        {group.edges.map(edge => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const mx = (from.x + to.x) / 2 + (to.y - from.y) * 0.12;
          const my = (from.y + to.y) / 2 - (to.x - from.x) * 0.12;
          return <path key={`${edge.kind}:${edge.from}>${edge.to}`} className={`edge ${edge.kind}`} d={`M${String(from.x)} ${String(from.y)} Q${String(mx)} ${String(my)} ${String(to.x)} ${String(to.y)}`} strokeWidth={edge.thickness * 1.5} markerEnd={`url(#arrow-${group.repositoryId})`}><title>{`${edge.kind} ${String(edge.count)}×`}</title></path>;
        })}
        {group.nodes.map(node => {
          const at = positions.get(node.sessionId);
          return at && (
            <g key={node.sessionId} className={`node tone-${node.status.color}`} transform={`translate(${String(at.x)} ${String(at.y)})`} tabIndex={0} role="link" aria-label={`${laneLabel(group.repositoryId, node.label)}, ${node.status.label}`}
              onClick={() => { navigate(sessionHref(node.sessionId)); }} onKeyDown={event => { if (event.key === 'Enter') navigate(sessionHref(node.sessionId)); }}>
              <circle r="15" /><text className="glyph" textAnchor="middle" dy="5">{node.status.glyph}</text><text className="label" textAnchor="middle" dy="32">{laneLabel(group.repositoryId, node.label)}</text>
            </g>);
        })}
      </svg>
    </Panel>
  );
}
