/**
 * Interim Requests and answers view. P5 replaces the import in `views/index.ts` with `views/requests/` once the derived
 * request model ships; until then this renders the API's request records, with the origin label and uncertainty shown
 * verbatim (a launch prompt or unproven origin is never presented as the human's words).
 */
import { requestListViewModel, wrap, pad, type RequestRow } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, fit, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import type { Env, SectionView } from './common.ts';

const originColor = (row: RequestRow) => (row.originLabel === 'Human request' ? 'blue' as const : 'amber' as const);

function detail(row: RequestRow | undefined, width: number): Line[] {
  if (!row) return [[t('Select a request', 'faint')]];
  const inner = width - 4;
  return [
    [...statusParts(row.status, 0, true), t(`  ${row.age} ago`, 'faint')], [t(row.originLabel, originColor(row), { bold: true })], [t(row.originEvidence, 'faint', { italic: true })], blank,
    heading('Request'), ...wrap(row.text, inner, 8).map((text): Line => [t(text, 'text')]), blank,
    heading('Answer'),
    ...(row.answer ? [[t('✓ final · ', 'green'), t(`${row.answer.age} ago`, 'faint')] as Line, ...wrap(row.answer.text, inner, 6).map((text): Line => [t(text, 'text')])]
      : [[t(row.status.status === 'interrupted' ? 'No final answer: interrupted by a reset.' : 'No final answer recorded yet.', 'muted')] as Line]),
    ...(row.partial ? [blank, [t('◐ partial answer, not final · ', 'amber'), t(`${row.partial.age} ago`, 'faint')] as Line, ...wrap(row.partial.text, inner, 5).map((text): Line => [t(text, 'muted')])] : []),
    ...(row.resetId ? [blank, [t('┃ ', 'pink'), t(`carried across reset ${row.resetId}`, 'muted')] as Line] : []),
  ];
}

export function requestsView(env: Env): SectionView {
  const model = requestListViewModel({ requests: env.data.requests, sessions: env.data.sessions, now: env.now });
  const rows = model.rows.filter(row => !env.ui.filter || `${row.text} ${row.session} ${row.originLabel} ${row.status.label}`.toLowerCase().includes(env.ui.filter.toLowerCase()));
  const wide = env.width >= 110;
  const width = (wide ? env.width - 52 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.requests, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 11), row.status.color), t(pad(row.originLabel, 15), originColor(row)), t(row.text, 'text')],
    [t(pad(row.session, 22), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Requests and answers · ${String(model.open)} open`, focused: true, grow: 1 }, h(Lines, { lines: lines.length ? lines : [[t(' Nothing matches.', 'muted')]], grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [h(Panel, { title: 'Provenance', width: 52 }, h(Lines, { lines: detail(rows[cursor], 52).map(line => fit(line, 48)) }))] : [])),
  };
}
