import { useEffect, useMemo, useState } from 'react';
import type { Graph } from '@pi-console/contract';
import { clock } from '@pi-console/viewmodels';
import { useActions } from '../app/commands.ts';

/** The graph's last-activity cutoff: off by default; `upTo` is infinite unless scrubbing. */
export interface GraphScrub { times: number[]; scrubbing: boolean; upTo: number; toggle: () => void; move: (at: number) => void }

/** Owned by the Messages view so its toggle can share the List/Graph toolbar row; `t` toggles it only while the graph shows. */
export function useGraphScrub(graph: Graph | null, enabled: boolean): GraphScrub {
  const times = useMemo(() => (graph?.edges ?? []).map(edge => Date.parse(edge.lastAt)).filter(Number.isFinite).sort((a, b) => a - b), [graph]);
  const [scrub, setScrub] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const toggle = () => { setScrubbing(value => !value); setScrub(null); };
  useEffect(() => { if (!enabled) { setScrubbing(false); setScrub(null); } }, [enabled]);
  useActions(action => { if (action !== 'time.scrub') return false; toggle(); return true; }, enabled);
  const active = enabled && scrubbing;
  const upTo = active ? (scrub ?? times.at(-1) ?? 0) : Number.POSITIVE_INFINITY;
  return { times, scrubbing: active, upTo, toggle, move: setScrub };
}

/** The toggle, and while scrubbing the range and its cutoff in the viewer's local time (as transcripts show it). */
export function GraphScrubber({ scrub }: { scrub: GraphScrub }) {
  const { times, scrubbing, upTo } = scrub;
  const last = times.at(-1) ?? 0;
  return (
    <span className="graph-scrub">
      <button type="button" className="btn" aria-pressed={scrubbing} onClick={scrub.toggle}>Time scrubber <kbd className="kbd">t</kbd></button>
      {scrubbing && times.length > 0 && <>
        <input type="range" className="scrubber" aria-label="Time scrubber" min={times[0]} max={last} step={1000} value={Math.min(upTo, last)} onChange={event => { scrub.move(Number(event.target.value)); }} />
        <time className="mono muted" dateTime={new Date(upTo).toISOString()}>{clock(new Date(upTo).toISOString())}</time><span className="muted" title="Hides lines last used after this time. Message counts are all-time.">Last-activity cutoff</span></>}
    </span>
  );
}
