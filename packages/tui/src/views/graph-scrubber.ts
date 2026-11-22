import { clock, type TimeWindow } from '@pi-console/viewmodels';
import type { Graph } from '@pi-console/contract';
import type { Line } from '../view/renderer.ts';
import { t } from '../view/parts.ts';
import type { Env } from './common.ts';

function activityWindow(graph: Graph): TimeWindow {
  const times = graph.edges.map(edge => Date.parse(edge.lastAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const start = times[0] ?? 0;
  return { start, span: (times.at(-1) ?? start) - start };
}

const timeLabel = (at: number): string => clock(new Date(at).toISOString());

/** Same last-activity cutoff as the web graph: lane edges only, with all-time counts. */
export function graphScrubber(env: Env): { upTo: number; time: { fit: TimeWindow; width: number }; lines: Line[] } {
  const fit = activityWindow(env.data.graph);
  const width = Math.max(1, env.width - 22);
  const column = Math.max(0, Math.min(width - 1, env.ui.scrubColumn));
  const at = fit.start + fit.span * column / Math.max(1, width - 1);
  const time = { fit, width };
  if (!env.ui.scrub) return { upTo: Infinity, time, lines: [[t('t time scrubber', 'faint')]] };
  const hints: Line = [t('h/← earlier · l/→ later · t/Esc hide', 'muted')];
  if (env.data.graph.edges.length === 0) return { upTo: 0, time, lines: [[t('Last-activity cutoff · no edge activity', 'faint')], hints] };
  const bar: Line = [
    t(`${timeLabel(fit.start)} [`, 'faint'), t('─'.repeat(column), 'cyan'), t('◆', 'cyan', { bold: true }),
    t('─'.repeat(width - column - 1), 'cyan'), t(`] ${timeLabel(fit.start + fit.span)}`, 'faint'),
  ];
  return { upTo: at, time, lines: [[t(`Last-activity cutoff ${timeLabel(at)} · counts are all-time`, 'text')], bar, hints] };
}
