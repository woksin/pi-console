import { graphViewModel, messagesViewModel, pad, wrap, age, type GraphEdgeView, type GraphViewModel, type MessageRow } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, fit, heading, selectable, split, t, windowOf } from '../view/parts.ts';
import type { Color } from '../view/theme.ts';
import type { Env, SectionView } from './common.ts';

const deliveryColor: Record<MessageRow['delivery'], Color> = { sent: 'faint', delivered: 'amber', read: 'green' };

function listView(env: Env): SectionView {
  const model = messagesViewModel({ messages: env.data.messages, sessions: env.data.sessions, now: env.now });
  const rows = model.rows.filter(row => !env.ui.filter || `${row.text} ${row.from} ${row.to}`.toLowerCase().includes(env.ui.filter.toLowerCase()));
  const width = env.width - 4;
  const cursor = Math.min(env.ui.cursor.messages, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [t(row.time, 'faint'), t('  '), t(pad(row.from, 7), 'cyan'), t('→ ', 'faint'), t(pad(row.to, 7), 'violet'), t(`${row.deliveryGlyph} ${pad(row.delivery, 10)}`, deliveryColor[row.delivery]), t(row.text, 'text')],
    [t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor, env.data.fresh.has(row.id)));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: rows[index]?.fromSessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Panel, { title: `Messages · ${String(rows.length)} · v for graph`, focused: true, grow: 1 },
      h(Lines, { lines: lines.length ? lines : [[t(' No messages.', 'muted')]], grow: 1, onLineClick: index => { env.click(start + index); } })),
  };
}

const arrow = (edge: GraphEdgeView, recent: boolean): { text: string; color: Color } => {
  const body = edge.kind === 'spawn' ? '╌╌╌╌╌╌' : edge.thickness === 3 ? '━━━━━━' : edge.thickness === 2 ? '──────' : '┄┄┄┄┄┄';
  return { text: `${body}▶`, color: recent ? 'green' : edge.kind === 'spawn' ? 'violet' : 'cyan' };
};

interface FlatEdge { edge: GraphEdgeView; group: string }

function graphLines(model: GraphViewModel, flat: readonly FlatEdge[], cursor: number, env: Env, width: number): { lines: Line[]; edgeLine: number[] } {
  const lines: Line[] = [];
  const edgeLine: number[] = [];
  let index = 0;
  for (const group of model.groups) {
    lines.push(fit([t('◆ ', 'cyan'), t(group.repositoryId, 'text', { bold: true }), t(`  ${String(group.messages)} messages · ${String(group.nodes.length)} sessions`, 'faint')], width));
    const label = new Map(group.nodes.map(node => [node.sessionId, node]));
    for (const edge of group.edges) {
      const from = label.get(edge.from);
      const to = label.get(edge.to);
      const recent = env.now - Date.parse(edge.lastAt) < 10_000;
      const link = arrow(edge, recent);
      edgeLine.push(lines.length);
      lines.push(selectable([
        t('  '), t(pad(from?.label ?? edge.from, 18), from?.status.color ?? 'muted'), t(' '), t(link.text, link.color, { bold: recent }), t(' '), t(pad(to?.label ?? edge.to, 18), to?.status.color ?? 'muted'),
        t(edge.kind === 'spawn' ? '  spawn' : `  ×${String(edge.count)}`, edge.kind === 'spawn' ? 'violet' : 'text'), t(`  ${age(edge.lastAt, env.now)} ago`, 'faint'),
      ], width, index === cursor));
      index++;
    }
    lines.push(blank);
  }
  void flat;
  return { lines, edgeLine };
}

function conversation(env: Env, edge: GraphEdgeView | undefined, width: number): Line[] {
  if (!edge) return [[t('Select an edge', 'faint')]];
  if (edge.kind === 'spawn') return [[t('Spawn edge', 'violet', { bold: true })], [t('The parent started this subagent.', 'muted')]];
  const lanes = new Map(env.data.sessions.map(session => [session.id, session.laneId]));
  const messages = env.data.messages.filter(message => message.fromSessionId === edge.from && message.toSessionId === edge.to).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).slice(0, 8);
  return [
    [t(`${lanes.get(edge.from) ?? edge.from} → ${lanes.get(edge.to) ?? edge.to}`, 'text', { bold: true })], [t(`${String(edge.count)} messages`, 'muted')], blank, heading('Recent'),
    ...messages.flatMap((message): Line[] => [[t(`${message.sentAt.slice(11, 19)} `, 'faint'), t(message.status, deliveryColor[message.status])], ...wrap(message.text, width - 4, 2).map((text): Line => [t('  ' + text, 'text')])]),
  ];
}

function graphView(env: Env): SectionView {
  const model = graphViewModel({ sessions: env.data.sessions, messages: env.data.messages });
  const flat = model.groups.flatMap(group => group.edges.map(edge => ({ edge, group: group.repositoryId })));
  const wide = env.width >= 110;
  const width = (wide ? env.width - 48 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.messages, Math.max(0, flat.length - 1));
  const { lines, edgeLine } = graphLines(model, flat, cursor, env, width);
  const visible = Math.max(1, env.height - 4);
  const focusLine = edgeLine[cursor] ?? 0;
  const { start, end } = windowOf(lines.length, focusLine, visible);
  return {
    length: flat.length,
    rowAt: index => ({ sessionId: flat[index]?.edge.from ?? null, groupId: null }),
    idAt: index => flat[index]?.edge.from ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: 'Communication graph · v for list', focused: true, grow: 1, right: `${String(flat.length)} edges` }, h(Lines, { lines: lines.slice(start, end), grow: 1 })),
      ...(wide ? [h(Panel, { title: 'Conversation', width: 48 }, h(Lines, { lines: conversation(env, flat[cursor]?.edge, 48) }))] : [])),
  };
}

export function messagesView(env: Env): SectionView {
  return env.ui.messagesGraph ? graphView(env) : listView(env);
}
