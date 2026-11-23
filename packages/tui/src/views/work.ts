import { emptyStates, filterWorkRows, lastInput, workRowAt, workStructure, pad } from '@pi-console/viewmodels';
import { Lines, Panel, h, type Line } from '../view/renderer.ts';
import { listFilter } from '../state/ui.ts';
import { selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, listBody, shownOf, type Env, type SectionView } from './common.ts';

/** The clock-free, filtered Work layout for the last jobs/sessions/filter inputs; a clock tick or cursor move reuses it. */
const layoutFor = lastInput((jobs: Env['data']['jobs'], sessions: Env['data']['sessions'], filter: string) => {
  const structure = workStructure({ jobs, sessions });
  return { structure, entries: filterWorkRows(structure.entries, filter) };
});

export function workView(env: Env): SectionView {
  const { structure: model, entries: rows } = layoutFor(env.data.jobs, env.data.sessions, listFilter(env.ui));
  const width = env.width - 4;
  const clampCursor = (index: number) => Math.max(0, Math.min(index, rows.length - 1));
  const cursor = clampCursor(env.ui.cursor.work);
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map(entry => workRowAt(entry, env.now)).map((row, offset): Line => selectable(split(
    [...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 9), row.status.color), t(pad(row.kind, 6), 'violet'), t(row.name, 'text'), t(row.exit ? `  ${row.exit}` : '', row.exit === 'exit 0' ? 'green' : 'red')],
    [t(pad(row.session, 24), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor, env.data.fresh.has(row.id)));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: env.data.jobs.find(job => job.id === rows[clampCursor(index)]?.id)?.sessionId ?? null, groupId: null }),
    idAt: index => rows[clampCursor(index)]?.id ?? null,
    render: () => h(Panel, { title: `Work · ${String(model.running)} running · ${String(model.failed)} failed${shownOf(env.data, 'jobs', rows.length)}`, focused: true, grow: 1 },
      h(Lines, { lines: listBody({ loaded: env.data.loaded, lines, query: listFilter(env.ui), noun: 'job', anyRows: model.entries.length > 0, empty: () => emptyLines(emptyStates.work, width) }), grow: 1, onLineClick: index => { env.click(start + index); } })),
  };
}
