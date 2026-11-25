import type { Request } from '@pi-console/contract';
import { fitSessionLabel, describeRequestFilter, emptyStates, pad, requestOriginGlyphs, requestsViewModel, type RequestsRow, type RequestsViewModel } from '@pi-console/viewmodels';
import { Column, Lines, Panel, Row, h, type Line } from '../../view/renderer.ts';
import { fit, selectable, split, statusParts, t, windowOf } from '../../view/parts.ts';
import { emptyLines, shownOf, whenLoaded, type Env, type SectionView } from '../common.ts';
import { requestDetailLines } from './detail.ts';
import { listFilter } from '../../state/ui.ts';

const DETAIL_WIDTH = 56;
const detailWidth = (env: Env): number => env.width < 140 ? 34 : DETAIL_WIDTH;
export const originColor = (row: { origin: RequestsRow['origin'] }) => (row.origin === 'human' ? 'blue' as const : 'amber' as const);

const originGlyph = requestOriginGlyphs;
const legend: Line = [t(' ● human · ◆ launch · ○ unproven', 'muted'), t(' · ≈ uncertain · ◌ unseen?', 'amber')];

/** Fixed glyph columns stay before the text, so clipping never hides uncertainty or possibly-unseen. */
const flags = (row: RequestsRow): Line => [t(row.uncertain ? '≈' : ' ', 'amber'), t(row.possiblyUnseen ? '◌' : ' ', 'amber'), t(' ')];

function rowLine(row: RequestsRow, env: Env, width: number, selected: boolean): Line {
  const text = t(row.text, row.withheld ? 'faint' : 'text', row.withheld ? { italic: true } : {});
  const sessionWidth = Math.max(12, Math.min(18, Math.floor(width * 0.18)));
  return selectable(split(
    [...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 12), row.status.color), t(` ${originGlyph[row.origin]} `, originColor(row)), ...flags(row), text],
    [t(pad(fitSessionLabel(row.session, sessionWidth, env.measure), sessionWidth, env.measure), 'muted'), t(row.age.padStart(4), 'faint')], width - 1, { measure: env.measure }), width, selected, { measure: env.measure });
}

const summaryLine = (model: RequestsViewModel): Line => [t(` ${describeRequestFilter(model)}`, 'muted'), t(`  ${String(model.rows.length)} shown · ${String(model.uncertain)} uncertain · ${String(model.possiblyUnseen)} unseen?`, 'faint')];

const detailPanel = (request: Request | undefined | false, env: Env) => {
  const width = detailWidth(env);
  return h(Panel, { title: 'Provenance', width }, h(Lines, { lines: requestDetailLines(request, env, width).map(line => fit(line, width - 4, undefined, env.measure)) }));
};

/** Requests and answers: list, filters (`[` `]` state, `o` origin, `S` session, `/` text) and the detail of the selected row; Enter opens the transcript at the prompt. */
export function requestsView(env: Env): SectionView {
  const filter = { ...env.ui.requestFilter, query: listFilter(env.ui) };
  const model = requestsViewModel({ requests: env.data.requests, sessions: env.data.sessions, now: env.now, filter });
  const { rows } = model;
  const wide = env.width >= 110;
  const width = (wide ? env.width - detailWidth(env) - 1 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.requests, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 6));
  const lines = rows.slice(start, end).map((row, offset) => rowLine(row, env, width, start + offset === cursor));
  const selected = rows[cursor] && env.data.requests.find(request => request.id === rows[cursor].id);
  return {
    length: rows.length,
    sessionIds: model.sessions.map(session => session.id),
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null, entryId: rows[index]?.transcript?.entryId ?? null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Column, { grow: 1 }, h(Lines, { lines: [fit(legend, env.width)], height: 1 }), h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Requests and answers · ${String(model.open)} open · ${String(rows.length)} of ${String(env.data.requests.length)}${shownOf(env.data, 'requests', model.rows.length)}`, focused: true, grow: 1 },
        h(Lines, { lines: [fit(summaryLine(model), width, undefined, env.measure)] }),
        h(Lines, { lines: lines.length ? lines : whenLoaded(env.data.loaded, () => env.data.requests.length ? [[t(' No request matches. Esc clears the filter.', 'muted')]] : emptyLines(emptyStates.requests, env.width - 4)), grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [detailPanel(selected, env)] : []))),
  };
}
