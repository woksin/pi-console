import { clip, memoryPanelViewModel, sessionViewModel, wrap, type SessionViewModel, type TranscriptLine } from '@pi-console/viewmodels';
import { Column, Lines, Panel, Row, h, type Line, type Part } from '../view/renderer.ts';
import type { Color } from '../view/theme.ts';
import { bar, blank, fit, pressureTone, rule, split, statusParts, t } from '../view/parts.ts';
import { sidePanes, type SidePane, type UiState } from '../state/ui.ts';
import { transcriptViewport, transcriptWindow, type TranscriptAnchor, type TranscriptLayout } from '../state/transcript-window.ts';
import type { Env, SectionView } from './common.ts';
import { memoryLines } from './session-memory.ts';

const LIMITS: Record<TranscriptLine['kind'], number> = { user: 8, thinking: 2, assistant: 14, tool: 1, result: 3, diff: 12, reset: 1 };

function diffLine(text: string): Line {
  const color = text.startsWith('+') ? 'green' : text.startsWith('-') ? 'red' : text.startsWith('@') ? 'violet' : 'muted';
  return [t(text, color)];
}

interface EntryStyle { color: Color; italic?: true; bold?: true }

function entryStyle(entry: TranscriptLine): EntryStyle {
  switch (entry.kind) {
    case 'thinking': return { color: 'faint', italic: true };
    case 'result': return { color: entry.tool?.resultKind === 'error' ? 'red' : 'muted' };
    case 'user': return { color: 'blue', bold: true };
    default: return { color: 'text' };
  }
}

function entryRows(entry: TranscriptLine, body: number): string[] {
  return entry.kind === 'diff' ? entry.text.split('\n').slice(0, LIMITS.diff).map(text => clip(text, body)) : wrap(entry.text, body, LIMITS[entry.kind]);
}

function toolLine(entry: TranscriptLine & { tool: NonNullable<TranscriptLine['tool']> }, stamp: Part, body: number): Line {
  return [stamp, t('⚙ ', 'cyan'), t(entry.tool.name, 'cyan', { bold: true }), t(' ' + clip(entry.tool.args, Math.max(4, body - entry.tool.name.length - 1)), 'muted')];
}

/** Turns one transcript entry into display lines for a column `width` cells wide. */
export function renderEntry(entry: TranscriptLine, width: number): Line[] {
  const stamp = t(`${entry.time} `, 'faint');
  const body = width - 12;
  if (entry.kind === 'reset') return [[stamp, ...rule(width - 9, `reset · ${entry.text}`, 'pink').map(part => ({ ...part, bold: true }))]];
  if (entry.kind === 'tool' && entry.tool) return [toolLine({ ...entry, tool: entry.tool }, stamp, body)];
  const lines = bodyLines(entry, stamp, body);
  if (entry.streaming && lines.length > 0) lines[lines.length - 1] = [...lines[lines.length - 1], t(' ▍', 'cyan')];
  if (entry.kind === 'assistant' || entry.kind === 'user') lines.push([t('')]);
  return lines;
}

const gutterOf = (entry: TranscriptLine, stamp: Part, first: boolean): Part[] => (first ? [stamp, t(`${entry.glyph} `, entry.color, { bold: true })] : [t(' '.repeat(10)), t('  ')]);

function bodyLines(entry: TranscriptLine, stamp: Part, body: number): Line[] {
  const style = entryStyle(entry);
  const content = (text: string): Line => (entry.kind === 'diff' ? diffLine(text) : [t(text, style.color, { bold: 'bold' in style, italic: 'italic' in style })]);
  return entryRows(entry, body).map((text, index): Line => [...gutterOf(entry, stamp, index === 0), ...content(text)]);
}

interface Rendered { lines: Line[]; layout: TranscriptLayout }
let linesCache: ({ key: unknown; width: number; search: string } & Rendered) | undefined;
let modelCache: { deps: readonly unknown[]; model: SessionViewModel } | undefined;

function layoutOf(entries: TranscriptLine[], rendered: Line[][]): TranscriptLayout {
  let end = 0;
  return { keys: entries.map(entry => entry.key), ends: rendered.map(lines => (end += lines.length)) };
}

function transcriptLines(env: Env, model: SessionViewModel, key: unknown, width: number): Rendered {
  const hit = linesCache;
  const wanted = { key, width, search: env.ui.search };
  if (hit && (Object.keys(wanted) as (keyof typeof wanted)[]).every(name => hit[name] === wanted[name])) return hit;
  const rendered = model.transcript.map(entry => renderEntry(entry, width));
  const fresh = { ...wanted, lines: rendered.flat(), layout: layoutOf(model.transcript, rendered) };
  linesCache = fresh;
  return fresh;
}

function header(model: SessionViewModel, width: number, phase: number): Line[] {
  return [
    split([...statusParts(model.status, phase), t('  '), t(model.title, 'text', { bold: true })], [t(`updated ${model.age} ago`, 'faint')], width),
    fit([t(`${model.role} · `, 'muted'), t(model.branch, 'violet'), t(` · ${model.model} · `, 'muted'), t(model.cost, 'text'), t('  ctx ', 'muted'), ...bar(model.context.percent, 14, pressureTone(model.context.pressure)), t(` ${String(model.context.percent)}% `, pressureTone(model.context.pressure)), t(model.context.spark.slice(-16), 'faint')], width),
  ];
}

type SidePaneBuilder = (model: SessionViewModel, inner: number) => Line[];

const requestLines: SidePaneBuilder = (model, inner) => model.requests.flatMap(request => [
  fit([...statusParts(request.status, 0, false), t(` ${request.originLabel}`, request.originLabel === 'Human request' ? 'blue' : 'amber'), t(` · ${request.status.label}`, request.status.color)], inner),
  ...wrap(request.text, inner - 2, 2).map((text): Line => [t('  ' + text, 'text')]),
  ...(request.answer ? [fit([t('  ✓ final: ', 'green'), t(request.answer.text, 'muted')], inner)] : []),
  ...(request.partial ? [fit([t('  ◐ partial, not final: ', 'amber'), t(request.partial.text, 'muted')], inner)] : []),
  blank,
]);

const questionLines: SidePaneBuilder = (model, inner) => model.questions.flatMap((question): Line[] => [
  fit([t(question.blocking ? '! ' : '? ', 'amber'), t(question.text, 'text')], inner),
  [t(`  ${question.status}${question.blocking ? ' · blocking' : ''}`, 'muted')],
]);

const jobLines: SidePaneBuilder = (model, inner) => [
  ...model.jobs.map(job => fit([...statusParts(job.status, 0, false), t(` ${job.name} `, 'text'), t(`${job.kind} ${job.exit}`, 'faint')], inner)),
  ...model.subagents.map(sub => fit([...statusParts(sub.status, 0, false), t(` ↳ ${sub.name}`, 'muted')], inner)),
];

const resetLines: SidePaneBuilder = (model, inner) => model.resets.flatMap((reset): Line[] => [
  fit([t('┃ ', 'pink'), t(`${reset.time} ${reset.kind}`, 'text')], inner),
  [t(`  carried ${String(reset.carried)} · interrupted ${String(reset.interrupted)}`, 'muted')],
]);

const sidePaneBuilders: Record<Exclude<SidePane, 'memory'>, SidePaneBuilder> = { requests: requestLines, questions: questionLines, jobs: jobLines, resets: resetLines };

function sideLines(model: SessionViewModel, pane: SidePane, width: number, memory: () => Line[]): Line[] {
  const tabs: Line = sidePanes.flatMap((name): Line => [t(` ${name} `, name === pane ? 'bg' : 'muted', { background: name === pane ? 'cyan' : undefined, bold: name === pane }), t(' ')]);
  const body = pane === 'memory' ? memory() : sidePaneBuilders[pane](model, width - 4);
  return [tabs, blank, ...(body.length === 0 ? [[t('Nothing here.', 'faint')]] : body)];
}

const unavailableView: SectionView = {
  length: 0,
  rowAt: () => ({ sessionId: null, groupId: null }),
  idAt: () => null,
  render: () => h(Panel, { title: 'Session', focused: true, grow: 1 }, h(Lines, { lines: [[t('This session is no longer available.', 'muted')]] })),
};

const droppedMarker: Line = [t('⋯ older lines dropped (transcript cap reached)', 'amber')];

function visibleLines(rendered: Rendered, ui: UiState, viewport: number): { padded: Line[]; below: number; paused: boolean } {
  const window = transcriptWindow(rendered.layout, ui, viewport);
  const shown = [...(window.dropped ? [droppedMarker] : []), ...rendered.lines.slice(window.start, window.end)];
  return { padded: [...Array.from({ length: viewport - shown.length }, () => blank), ...shown], below: window.below, paused: window.paused };
}

function statusText(search: string, paused: boolean, entries: number, above: number): string {
  if (search) return `matching “${search}” · ${String(entries)} entries`;
  return !paused ? '● following tail' : `⏸ paused · ${String(above)} lines above live · f to follow`;
}

const contextPanel = (model: SessionViewModel, pane: SidePane, side: number, memory: () => Line[]) => (side ? [h(Panel, { title: 'Context', width: side }, h(Lines, { lines: sideLines(model, pane, side, memory) }))] : []);

/** Where a jump from the Requests list lands: the entry's line at the top. `undefined` until the entry is in the transcript (live entries can arrive before the backfill page, so absence is not final). */
function focusAnchor(entryId: string | null, lines: readonly TranscriptLine[], layout: TranscriptLayout): TranscriptAnchor | undefined {
  const found = entryId === null ? undefined : lines.find(line => line.id === entryId);
  return found ? { key: found.key, offset: 0, limit: layout.keys.at(-1) ?? 0 } : undefined;
}

export function sessionView(env: Env): SectionView {
  const { data, ui } = env;
  const detail = ui.sessionId ? buildDetail(env) : undefined;
  if (!detail) return unavailableView;
  const { model, entries } = detail;
  const side = env.width >= 110 ? 40 : 0;
  const transcriptWidth = env.width - side - 4;
  const rendered = transcriptLines(env, model, entries, transcriptWidth);
  const { padded, below, paused } = visibleLines(rendered, ui, transcriptViewport(env.height));
  const following = ui.follow;
  const status = statusText(ui.search, paused, model.transcript.length, below);
  const loading = !data.transcripts.has(model.id) && model.transcript.length === 0;
  return {
    length: rendered.lines.length,
    transcript: rendered.layout,
    focus: () => focusAnchor(ui.focusEntry, model.transcript, rendered.layout),
    rowAt: () => ({ sessionId: null, groupId: null }),
    idAt: () => model.id,
    render: () => h(Column, { grow: 1 },
      h(Panel, { height: 4, focused: false }, h(Lines, { lines: header(model, env.width - 4, env.phase) })),
      h(Row, { grow: 1, gap: 1 },
        h(Panel, { title: 'Transcript', right: status, grow: 1, focused: true, accent: following ? 'green' : 'amber' },
          h(Lines, { lines: loading ? [[t('Loading transcript…', 'muted')]] : padded, grow: 1 })),
        ...contextPanel(model, ui.pane, side, () => memoryLines(memoryPanelViewModel({ memory: data.memory.get(model.id) ?? null, items: data.memoryItems.get(model.id) ?? [], now: env.now }), side - 4)))),
  };
}

function buildDetail(env: Env): { model: SessionViewModel; entries: unknown } | undefined {
  const id = env.ui.sessionId;
  if (!id) return undefined;
  const session = env.data.sessions.find(item => item.id === id);
  if (!session) return undefined;
  const own = <T extends { sessionId: string }>(items: T[]) => items.filter(item => item.sessionId === id);
  const entries = env.data.transcripts.get(id) ?? [];
  const deps = [id, session, env.data.requests, env.data.questions, env.data.jobs, env.data.resets, env.data.sessions, entries, env.ui.search, Math.floor(env.now / 1000)];
  const hit = modelCache;
  if (hit?.deps.every((dep, index) => dep === deps[index])) return { model: hit.model, entries };
  const model = sessionViewModel({
    detail: { session, requests: own(env.data.requests), questions: own(env.data.questions), jobs: own(env.data.jobs), resets: own(env.data.resets), subagents: env.data.sessions.filter(item => item.parentSessionId === id) },
    transcript: entries, now: env.now, search: env.ui.search,
  });
  modelCache = { deps, model };
  return { model, entries };
}
