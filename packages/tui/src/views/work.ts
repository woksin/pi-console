import { workViewModel, pad } from '@pi-console/viewmodels';
import { Lines, Panel, h, type Line } from '../view/renderer.ts';
import { selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { shownOf, type Env, type SectionView } from './common.ts';

export function workView(env: Env): SectionView {
  const model = workViewModel({ jobs: env.data.jobs, sessions: env.data.sessions, now: env.now });
  const rows = model.rows;
  const width = env.width - 4;
  const cursor = Math.min(env.ui.cursor.work, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 9), row.status.color), t(pad(row.kind, 6), 'violet'), t(row.name, 'text'), t(row.exit ? `  ${row.exit}` : '', row.exit === 'exit 0' ? 'green' : 'red')],
    [t(pad(row.session, 24), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor, env.data.fresh.has(row.id)));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: env.data.jobs.find(job => job.id === rows[index]?.id)?.sessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Panel, { title: `Work · ${String(model.running)} running · ${String(model.failed)} failed${shownOf(env.data, 'jobs', rows.length)}`, focused: true, grow: 1 },
      h(Lines, { lines: lines.length ? lines : [[t(' No jobs or phases.', 'muted')]], grow: 1, onLineClick: index => { env.click(start + index); } })),
  };
}
