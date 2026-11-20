import type { Request } from '@pi-console/contract';
import { describeRequestFilter, pad, requestsViewModel, type RequestsRow, type RequestsViewModel } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../../view/renderer.ts';
import { fit, selectable, split, statusParts, t, windowOf } from '../../view/parts.ts';
import type { Env, SectionView } from '../common.ts';
import { requestDetailLines } from './detail.ts';

const DETAIL_WIDTH = 56;
export const originColor = (row: { origin: RequestsRow['origin'] }) => (row.origin === 'human' ? 'blue' as const : 'amber' as const);

/** Uncertain and possibly-unseen are shown on the row itself, never only in the detail; they precede the request text so clipping cuts the text, not the flag. */
const flags = (row: RequestsRow) => [...(row.uncertain ? [t('≈ uncertain ', 'amber')] : []), ...(row.possiblyUnseen ? [t('◌ unseen? ', 'amber')] : [])];

function rowLine(row: RequestsRow, env: Env, width: number, selected: boolean): Line {
  const text = t(row.text, row.withheld ? 'faint' : 'text', row.withheld ? { italic: true } : {});
  return selectable(split(
    [...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 12), row.status.color), t(pad(row.originLabel, 16), originColor(row)), ...flags(row), text],
    [t(pad(row.session, width >= 100 ? 22 : 14), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, selected);
}

const summaryLine = (model: RequestsViewModel): Line => [t(` ${describeRequestFilter(model)}`, 'muted'), t(`  ${String(model.rows.length)} shown · ${String(model.uncertain)} uncertain · ${String(model.possiblyUnseen)} unseen?`, 'faint')];

const detailPanel = (request: Request | undefined | false, env: Env) => h(Panel, { title: 'Provenance', width: DETAIL_WIDTH }, h(Lines, { lines: requestDetailLines(request, env, DETAIL_WIDTH).map(line => fit(line, DETAIL_WIDTH - 4)) }));

/** Requests and answers: list, filters (`[` `]` state, `o` origin, `S` session, `/` text) and the detail of the selected row; Enter opens the transcript at the prompt. */
export function requestsView(env: Env): SectionView {
  const filter = { ...env.ui.requestFilter, query: env.ui.filter };
  const model = requestsViewModel({ requests: env.data.requests, sessions: env.data.sessions, now: env.now, filter });
  const { rows } = model;
  const wide = env.width >= 110;
  const width = (wide ? env.width - DETAIL_WIDTH - 1 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.requests, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 5));
  const lines = rows.slice(start, end).map((row, offset) => rowLine(row, env, width, start + offset === cursor));
  const selected = rows[cursor] && env.data.requests.find(request => request.id === rows[cursor].id);
  return {
    length: rows.length,
    sessionIds: model.sessions.map(session => session.id),
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null, entryId: rows[index]?.transcript?.entryId ?? null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Requests and answers · ${String(model.open)} open`, focused: true, grow: 1 },
        h(Lines, { lines: [fit(summaryLine(model), width)] }),
        h(Lines, { lines: lines.length ? lines : [[t(' Nothing matches.', 'muted')]], grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [detailPanel(selected, env)] : [])),
  };
}
