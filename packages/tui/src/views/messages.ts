import { emptyStates, repositoryLabel, graphViewModel, filterMessageRows, fitSessionLabel, sessionLabels, displayWidth, messagesViewModel, pad, wrap, age, type LaneGraphEdgeView, type MessageRow } from '@pi-console/viewmodels';
import { Column, Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, fit, heading, selectable, split, t, windowOf } from '../view/parts.ts';
import type { Color } from '../view/theme.ts';
import { emptyLines, listBody, loadingLines, shownOf, type Env, type SectionView } from './common.ts';
import { graphScrubber } from './graph-scrubber.ts';

const deliveryColor: Record<MessageRow['delivery'], Color> = { sent: 'faint', delivered: 'amber', read: 'green' };

function listView(env: Env): SectionView {
  const model = messagesViewModel({ messages: env.data.messages, sessions: env.data.sessions, now: env.now });
  const rows = filterMessageRows(model.rows, env.ui.filter);
  const identities = new Map(env.data.sessions.map(session => [session.id, sessionLabels(session)]));
  const endpoint = (id: string, fallback: string): string => {
    const label = fitSessionLabel(identities.get(id) ?? { name: fallback, lane: '' }, 14, env.measure);
    return label + ' '.repeat(Math.max(0, 14 - (env.measure ?? displayWidth)(label)));
  };
  const width = env.width - 4;
  const cursor = Math.min(env.ui.cursor.messages, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [t(row.time, 'faint'), t('  '), t(endpoint(row.fromSessionId, row.from), 'cyan'), t(' → ', 'faint'), t(endpoint(row.toSessionId, row.to), 'violet'), t(` ${row.deliveryGlyph} ${pad(row.delivery, 10)}`, deliveryColor[row.delivery]), t(row.text, 'text')],
    [t(row.age.padStart(4), 'faint')], width - 1, { measure: env.measure }), width, start + offset === cursor, { flash: env.data.fresh.has(row.id), measure: env.measure }));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: rows[index]?.fromSessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Panel, { title: `Messages · ${String(rows.length)}${shownOf(env.data, 'messages', rows.length)} · v for graph`, focused: true, grow: 1 },
      h(Lines, { lines: listBody({ loaded: env.data.loaded, lines, query: env.ui.filter, noun: 'message', anyRows: model.rows.length > 0, empty: () => emptyLines(emptyStates.messages, env.width - 4) }), grow: 1, onLineClick: index => { env.click(start + index); } })),
  };
}

interface DisplayEdge {
  from: string; to: string; kind: LaneGraphEdgeView['kind']; count: number; lastAt: string; thickness: 1 | 2 | 3;
  /** Only session spawn edges can navigate to a session. Lane ids are never session ids. */
  sessionId: string | null;
}
interface DisplayGroup { title: string; nodes: Map<string, { label: string; color: Color }>; edges: DisplayEdge[] }

function graphGroups(env: Env, upTo: number): DisplayGroup[] {
  const graph = { ...env.data.graph, edges: env.data.graph.edges.filter(edge => Date.parse(edge.lastAt) <= upTo) };
  const lanes = graphViewModel({ graph }).groups.filter(group => group.edges.length > 0).map((group): DisplayGroup => ({
    title: `${group.repositoryId === null ? 'Unassigned lanes' : repositoryLabel(group.repositoryId)} · ${String(group.messages)} messages · ${String(group.nodes.length)} lanes`,
    nodes: new Map(group.nodes.map(node => [node.laneId, { label: node.label, color: 'cyan' }])),
    edges: group.edges.map(edge => ({ from: edge.fromLane, to: edge.toLane, kind: edge.kind, count: edge.count, lastAt: edge.lastAt, thickness: edge.thickness, sessionId: null })),
  }));
  const sessions = graphViewModel({ sessions: env.data.sessions, messages: [] }).groups.map((group): DisplayGroup => ({
    title: `Session relationships · ${repositoryLabel(group.repositoryId)}`,
    nodes: new Map(group.nodes.map(node => [node.sessionId, { label: node.label, color: node.status.color }])),
    edges: group.edges.map(edge => ({ ...edge, sessionId: edge.from })),
  }));
  return [...lanes, ...sessions];
}

const arrow = (edge: DisplayEdge, recent: boolean): { text: string; color: Color } => {
  const body = edge.kind === 'spawn' ? '╌╌╌╌╌╌' : edge.thickness === 3 ? '━━━━━━' : edge.thickness === 2 ? '──────' : '┄┄┄┄┄┄';
  return { text: `${body}▶`, color: recent ? 'green' : edge.kind === 'spawn' ? 'violet' : 'cyan' };
};

function edgeCount(edge: DisplayEdge): string {
  if (edge.kind === 'spawn') return '  spawn';
  return `  ×${String(edge.count)}${edge.kind !== 'message' ? ` ${edge.kind}` : ''}`;
}

function edgeLine(edge: DisplayEdge, group: DisplayGroup, env: Env, layout: { width: number; selected: boolean }): Line {
  const from = group.nodes.get(edge.from);
  const to = group.nodes.get(edge.to);
  const recent = env.now - Date.parse(edge.lastAt) < 10_000;
  const link = arrow(edge, recent);
  return selectable([
    t('  '), t(pad(from?.label ?? edge.from, 18, env.measure), from?.color ?? 'muted'), t(' '), t(link.text, link.color, { bold: recent }), t(' '), t(pad(to?.label ?? edge.to, 18, env.measure), to?.color ?? 'muted'),
    t(edgeCount(edge), edge.kind === 'spawn' ? 'violet' : 'text'), t(`  ${age(edge.lastAt, env.now)} ago`, 'faint'),
  ], layout.width, layout.selected, { measure: env.measure });
}

function graphLines(groups: DisplayGroup[], cursor: number, env: Env, width: number): { lines: Line[]; edgeLine: number[] } {
  const lines: Line[] = [];
  const positions: number[] = [];
  let index = 0;
  for (const group of groups) {
    lines.push(fit([t('◆ ', 'cyan'), t(group.title, 'text', { bold: true })], width, undefined, env.measure));
    for (const edge of group.edges) {
      positions.push(lines.length);
      lines.push(edgeLine(edge, group, env, { width, selected: index === cursor }));
      index++;
    }
    lines.push(blank);
  }
  return { lines, edgeLine: positions };
}

function conversation(env: Env, edge: DisplayEdge | undefined, width: number): Line[] {
  if (!edge) return [[t('Select an edge', 'faint')]];
  if (edge.kind === 'spawn') return [[t('Spawn edge', 'violet', { bold: true })], [t('The parent started this subagent.', 'muted')]];
  const lanes = new Map(env.data.graph.nodes.map(node => [node.laneId, node.label]));
  const sessionLanes = new Map(env.data.sessions.map(session => [session.id, session.laneId]));
  // Daemon messages carry lane IDs; session-based sources need their endpoints mapped to lanes.
  const laneOf = (endpoint: string) => sessionLanes.get(endpoint) ?? (lanes.has(endpoint) ? endpoint : undefined);
  const messages = env.data.messages.filter(message => laneOf(message.fromSessionId) === edge.from && laneOf(message.toSessionId) === edge.to).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).slice(0, 8);
  return [
    [t(`${lanes.get(edge.from) ?? edge.from} → ${lanes.get(edge.to) ?? edge.to}`, 'text', { bold: true })], [t(`${String(edge.count)} ${edge.kind === 'message' ? 'messages' : edge.kind}`, 'muted')], blank, heading('Recent'),
    ...messages.flatMap((message): Line[] => [[t(`${message.sentAt.slice(11, 19)} `, 'faint'), t(message.status, deliveryColor[message.status])], ...wrap(message.text, width - 4, 2, env.measure).map((text): Line => [t('  ' + text, 'text')])]),
  ];
}

/** The failed graph read, with how to retry it; says when the graph below is the last one that loaded. */
const graphFailureLines = (stale: boolean): Line[] => [[t(' Could not load the graph', 'amber'), t(stale ? ' · showing the last loaded graph. ' : '. ', 'amber'), t('r', 'cyan'), t(' retry', 'muted')]];

/** No edges to draw: still loading, failed, or genuinely nothing yet. */
const graphEmptyLines = (env: Env, failed: boolean, width: number): Line[] => {
  if (failed) return [];
  return env.data.graphLoaded ? emptyLines(emptyStates.graph, width) : loadingLines();
};

function graphView(env: Env): SectionView {
  const scrubber = graphScrubber(env);
  const groups = graphGroups(env, scrubber.upTo);
  const flat = groups.flatMap(group => group.edges);
  const wide = env.width >= 110;
  const width = (wide ? env.width - 48 : env.width) - 4;
  const clampCursor = (index: number) => Math.max(0, Math.min(index, flat.length - 1));
  const cursor = clampCursor(env.ui.cursor.messages);
  const graph = graphLines(groups, cursor, env, width);
  const { edgeLine } = graph;
  const failure = env.data.graphError ? graphFailureLines(env.data.graph.nodes.length > 0 || env.data.graph.edges.length > 0) : [];
  const lines = graph.lines.length ? graph.lines : graphEmptyLines(env, failure.length > 0, width);
  const visible = Math.max(1, env.height - 4 - scrubber.lines.length - failure.length);
  const focusLine = edgeLine[cursor] ?? 0;
  const { start, end } = windowOf(lines.length, focusLine, visible);
  return {
    length: flat.length,
    time: scrubber.time,
    rowAt: index => ({ sessionId: flat[clampCursor(index)]?.sessionId ?? null, groupId: null }),
    idAt: index => flat[clampCursor(index)]?.from ?? null,
    render: () => h(Column, { grow: 1 },
      h(Lines, { lines: scrubber.lines }),
      h(Row, { grow: 1, gap: 1 },
        h(Panel, { title: 'Communication graph · v for list', focused: true, grow: 1, right: `${String(flat.length)} edges` }, h(Lines, { lines: failure }), h(Lines, { lines: lines.slice(start, end), grow: 1 })),
        ...(wide ? [h(Panel, { title: 'Conversation', width: 48 }, h(Lines, { lines: conversation(env, flat[cursor], 48) }))] : []))),
  };
}

export function messagesView(env: Env): SectionView {
  return env.ui.messagesGraph ? graphView(env) : listView(env);
}
