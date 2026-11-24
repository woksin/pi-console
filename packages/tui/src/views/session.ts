import { displayWidth, fitSessionLabel, sessionLabels, glyphs, clip, startsNewDay, timeDisplay, memoryPanelViewModel, sessionViewModel, wrap, type ResetRequest, type SessionViewModel, type TranscriptLine, type TextWidth } from '@pi-console/viewmodels';
import { Column, Lines, Panel, Row, h, type Line, type Part } from '../view/renderer.ts';
import { pressureBar, blank, fit, pressureTone, rule, split, statusParts, t, type CellBudget } from '../view/parts.ts';
import { sidePanes, type SidePane, type UiState } from '../state/ui.ts';
import { sessionSideWidth } from '../state/session-layout.ts';
import { topEntryKey, transcriptViewport, transcriptWindow, type TranscriptAnchor, type TranscriptLayout } from '../state/transcript-window.ts';
import type { Env, SectionView } from './common.ts';
import { memoryLines } from './session-memory.ts';
import { LIMITS, diffColor, entryStyle, previewNote } from './entry.ts';

const diffLine = (text: string): Line => [t(text, diffColor(text))];

function entryRows(entry: TranscriptLine, body: number, measure?: TextWidth): string[] {
  return entry.kind === 'diff' ? entry.text.split('\n').slice(0, LIMITS.diff).map(text => clip(text, body, measure)) : wrap(entry.text, body, LIMITS[entry.kind], measure);
}

function toolLine(entry: TranscriptLine & { tool: NonNullable<TranscriptLine['tool']> }, stamp: Part, body: number, measure?: TextWidth): Line {
  return [stamp, t(`${glyphs.tool} `, 'cyan'), t(entry.tool.name, 'cyan', { bold: true }), t(' ' + clip(entry.tool.args, Math.max(4, body - entry.tool.name.length - 1), measure), 'muted')];
}

/** The last `cells` samples of the context sparkline; a sample with a reset tick is drawn pink. */
function contextSpark(context: SessionViewModel['context'], cells: number): Part[] {
  const start = Math.max(0, context.spark.length - cells);
  const marks = new Set(context.resetMarks);
  return Array.from(context.spark.slice(start), (cell, index) => t(cell, marks.has(start + index) ? 'pink' : 'faint', marks.has(start + index) ? { bold: true } : {}));
}

/** A request list under a reset rule: `carried  r1 Compare the queue…`, one request per line. */
const resetRequestLines = (label: string, requests: readonly ResetRequest[], width: number, measure?: TextWidth): Line[] => requests.map((request, index): Line =>
  [t(' '.repeat(10)), t('┊ ', 'pink'), t((index === 0 ? label : '').padEnd(12), 'muted'), t(`${request.id} `, 'faint'), t(clip(request.text, Math.max(4, width - 26 - request.id.length), measure), 'text')]);

/** The `⟲` divider: a bold pink rule naming the kind and counts, then what was carried over and what was interrupted. */
function resetDividerLines(entry: TranscriptLine, stamp: Part, width: number, measure?: TextWidth): Line[] {
  const title = entry.reset ? entry.reset.summary : `reset · ${entry.text}`;
  const head: Line = [stamp, ...rule(width - 9, `${glyphs.reset} ${title}`, 'pink', measure).map(part => ({ ...part, bold: true }))];
  if (!entry.reset) return [head];
  return [head, ...resetRequestLines('carried', entry.reset.carried, width, measure), ...resetRequestLines('interrupted', entry.reset.interrupted, width, measure), [t('')]];
}

/** Turns one transcript entry into display lines for a column `width` cells wide. */
export function renderEntry(entry: TranscriptLine, width: number, measure?: TextWidth): Line[] {
  const stamp = t(`${entry.time} `, 'faint');
  const body = width - 12;
  if (entry.kind === 'reset') return resetDividerLines(entry, stamp, width, measure);
  if (entry.kind === 'tool' && entry.tool) return [toolLine({ ...entry, tool: entry.tool }, stamp, body, measure), ...footerLines(entry, stamp, body, measure)];
  const lines = bodyLines(entry, stamp, body, measure);
  if (entry.streaming && lines.length > 0) lines[lines.length - 1] = [...lines[lines.length - 1], t(' ▍', 'cyan')];
  return [...lines, ...footerLines(entry, stamp, body, measure)];
}

/** Under a preview: the "… N more lines" row when it was cut short, and the blank spacer after prose entries. */
function footerLines(entry: TranscriptLine, stamp: Part, body: number, measure?: TextWidth): Line[] {
  const note = previewNote(entry, body, measure);
  const spacer: Line[] = entry.kind === 'assistant' || entry.kind === 'user' ? [[t('')]] : [];
  return note ? [[...gutterOf(entry, stamp, false), t(note, 'amber')], ...spacer] : spacer;
}

const gutterOf = (entry: TranscriptLine, stamp: Part, first: boolean): Part[] => (first ? [stamp, t(`${glyphs[entry.kind]} `, entry.color, { bold: true })] : [t(' '.repeat(10)), t('  ')]);

function bodyLines(entry: TranscriptLine, stamp: Part, body: number, measure?: TextWidth): Line[] {
  const style = entryStyle(entry);
  const content = (text: string): Line => (entry.kind === 'diff' ? diffLine(text) : [t(text, style.color, { bold: 'bold' in style, italic: 'italic' in style })]);
  return entryRows(entry, body, measure).map((text, index): Line => [...gutterOf(entry, stamp, index === 0), ...content(text)]);
}

interface Rendered { lines: Line[]; layout: TranscriptLayout }
let linesCache: ({ key: unknown; width: number; search: string; measure?: TextWidth } & Rendered) | undefined;
let modelCache: { deps: readonly unknown[]; model: SessionViewModel } | undefined;

const isBlank = (line: Line | undefined): boolean => line?.every(part => part.text === '') === true;

function layoutOf(entries: TranscriptLine[], rendered: Line[][], leads: number[]): TranscriptLayout {
  let end = 0;
  return { keys: entries.map(entry => entry.key), ends: rendered.map(lines => (end += lines.length)), spacers: rendered.map(lines => isBlank(lines.at(-1))), leads };
}

/** The compact calendar-day rule that opens each displayed local day; a decoration of the entry below it, never an entry of its own. */
const dateRule = (entry: TranscriptLine, width: number, measure?: TextWidth): Line => [t(' '.repeat(10)), ...rule(Math.max(1, width - 10), timeDisplay(entry.at).date, 'faint', measure)];

/** Each entry's rows, with a date rule above the first entry of every displayed local day. */
function renderTranscript(entries: readonly TranscriptLine[], width: number, measure?: TextWidth): { rendered: Line[][]; leads: number[] } {
  const leads: number[] = [];
  const rendered = entries.map((entry, index): Line[] => {
    const starts = timeDisplay(entry.at).dayKey !== '' && startsNewDay(entries[index - 1]?.at, entry.at);
    leads.push(starts ? 1 : 0);
    return starts ? [dateRule(entry, width, measure), ...renderEntry(entry, width, measure)] : renderEntry(entry, width, measure);
  });
  return { rendered, leads };
}

function transcriptLines(env: Env, model: SessionViewModel, key: unknown, width: number): Rendered {
  const hit = linesCache;
  const wanted = { key, width, search: env.ui.search, measure: env.measure };
  if (hit && (Object.keys(wanted) as (keyof typeof wanted)[]).every(name => hit[name] === wanted[name])) return hit;
  const { rendered, leads } = renderTranscript(model.transcript, width, env.measure);
  const fresh = { ...wanted, lines: rendered.flat(), layout: layoutOf(model.transcript, rendered, leads) };
  linesCache = fresh;
  return fresh;
}

function headerMetadata(model: SessionViewModel): Line {
  return [t(model.role, 'muted'), ...(model.branch ? [t(model.branch, 'violet')] : []), ...(model.model ? [t(model.model, 'muted')] : [])]
    .flatMap(part => [part, t(' · ', 'muted')]);
}

function header(model: SessionViewModel, width: number, phase: number, measure: TextWidth = displayWidth): Line[] {
  const status = [...statusParts(model.status, phase), t('  ')];
  const updated = [t(`updated ${model.age} ago`, 'faint')];
  const label = fitSessionLabel(model.identity, width - measure(status.map(part => part.text).join('')) - measure(updated.map(part => part.text).join('')) - 1, measure);
  return [
    split([...status, t(label, 'text', { bold: true })], updated, width, { measure }),
    fit([...headerMetadata(model), t(model.cost, 'text'), t('  ctx ', 'muted'), ...pressureBar(model.context.percent, 14), t(` ${String(model.context.percent)}% `, pressureTone(model.context.pressure)), ...contextSpark(model.context, 16)], width, undefined, measure),
  ];
}

type SidePaneBuilder = (model: SessionViewModel, inner: number, measure?: TextWidth) => Line[];

const requestLines: SidePaneBuilder = (model, inner, measure) => model.requests.flatMap(request => [
  fit([...statusParts(request.status, 0, false), t(` ${request.originLabel}`, request.originLabel === 'Human request' ? 'blue' : 'amber'), t(` · ${request.status.label}`, request.status.color)], inner, undefined, measure),
  ...wrap(request.text, inner - 2, 2, measure).map((text): Line => [t('  ' + text, 'text')]),
  ...(request.answer ? [fit([t('  ✓ final: ', 'green'), t(request.answer.text, 'muted')], inner, undefined, measure)] : []),
  ...(request.partial ? [fit([t('  ◐ partial, not final: ', 'amber'), t(request.partial.text, 'muted')], inner, undefined, measure)] : []),
  blank,
]);

const questionLines: SidePaneBuilder = (model, inner, measure) => model.questions.flatMap((question): Line[] => [
  fit([t(question.blocking ? '! ' : '? ', 'amber'), t(question.text, 'text')], inner, undefined, measure),
  [t(`  ${question.status}${question.blocking ? ' · blocking' : ''}`, 'muted')],
]);

const jobLines: SidePaneBuilder = (model, inner, measure) => [
  ...model.jobs.map(job => fit([...statusParts(job.status, 0, false), t(` ${job.name} `, 'text'), t(`${job.kind} ${job.exit}`, 'faint')], inner, undefined, measure)),
  ...model.subagents.map(sub => fit([...statusParts(sub.status, 0, false), t(` ↳ ${fitSessionLabel(sub.identity, inner - 4, measure)}`, 'muted')], inner, undefined, measure)),
];

const resetLines: SidePaneBuilder = (model, inner, measure) => model.resets.flatMap((reset): Line[] => [
  fit([t('┃ ', 'pink'), t(`${reset.time} ${reset.kind}`, 'text')], inner, undefined, measure),
  [t(`  carried ${String(reset.carried)} · interrupted ${String(reset.interrupted)}`, 'muted')],
]);

const sidePaneBuilders: Record<Exclude<SidePane, 'memory'>, SidePaneBuilder> = { requests: requestLines, questions: questionLines, jobs: jobLines, resets: resetLines };

function sideLines(model: SessionViewModel, pane: SidePane, budget: CellBudget, memory: () => Line[]): Line[] {
  const { width, measure } = budget;
  const tabs: Line = sidePanes.flatMap((name): Line => [t(` ${name} `, name === pane ? 'bg' : 'muted', { background: name === pane ? 'cyan' : undefined, bold: name === pane }), t(' ')]);
  const body = pane === 'memory' ? memory() : sidePaneBuilders[pane](model, width - 4, measure);
  return [tabs, blank, ...(body.length === 0 ? [[t('Nothing here.', 'faint')]] : body)];
}

const unavailableView: SectionView = {
  length: 0,
  rowAt: () => ({ sessionId: null, groupId: null }),
  idAt: () => null,
  render: () => h(Panel, { title: 'Session', focused: true, grow: 1 }, h(Lines, { lines: [[t('This session is no longer available.', 'muted')]] })),
};

const droppedMarker: Line = [t('⋯ view moved to the retained window edge', 'amber')];

function visibleLines(rendered: Rendered, ui: UiState, viewport: number): { padded: Line[]; below: number; paused: boolean } {
  const window = transcriptWindow(rendered.layout, ui, viewport);
  const shown = [...(window.dropped ? [droppedMarker] : []), ...rendered.lines.slice(window.start, window.end)];
  return { padded: [...Array.from({ length: viewport - shown.length }, () => blank), ...shown], below: window.below, paused: window.paused };
}

function statusText({ search, paused, entries, above, newer }: { search: string; paused: boolean; entries: number; above: number; newer: boolean }): string {
  if (search) return `matching “${search}” · ${String(entries)} entries`;
  return !paused ? '● following tail' : newer ? '⏸ paused · f to follow' : `⏸ paused · ${String(above)} lines above live · f to follow`;
}

const contextPanel = (model: SessionViewModel, pane: SidePane, budget: CellBudget, memory: () => Line[]) => (budget.width ? [h(Panel, { title: 'Context', width: budget.width }, h(Lines, { lines: sideLines(model, pane, budget, memory) }))] : []);

/** Where a jump from the Requests list lands: the entry's line at the top. `undefined` until the entry is in the transcript (live entries can arrive before the backfill page, so absence is not final). */
function focusAnchor(entryId: string | null, lines: readonly TranscriptLine[], layout: TranscriptLayout): TranscriptAnchor | undefined {
  const found = entryId === null ? undefined : lines.find(line => line.id === entryId);
  return found ? { key: found.key, offset: -(layout.leads?.[layout.keys.indexOf(found.key)] ?? 0), limit: layout.keys.at(-1) ?? 0 } : undefined;
}

function transcriptEdges(env: Env, width: number): { above: Line[]; below: Line[] } {
  const progress = env.data.transcriptHistory.get(env.ui.sessionId ?? '');
  if (!progress) return { above: [], below: [] };
  const above: Line[] = [];
  if (progress.older) above.push(fit([t('older entries above — scroll up to load', 'muted')], width));
  if (progress.loading) above.push(fit([t('Loading transcript…', 'muted')], width));
  if (progress.error) above.push(fit([t('Could not load transcript · r retry', 'amber')], width));
  const below = progress.newer ? [fit([t('newer entries below', 'muted')], width)] : [];
  return { above, below };
}

function transcriptContent(env: Env, model: SessionViewModel, rendered: Rendered, width: number) {
  const progress = env.data.transcriptHistory.get(model.id);
  const edges = transcriptEdges(env, width);
  const viewport = Math.max(1, transcriptViewport(env.height) - edges.above.length - edges.below.length);
  const newer = progress?.newer === true;
  const following = env.ui.follow && !newer;
  const view = { ...env.ui, follow: following };
  const { padded, below } = visibleLines(rendered, view, viewport);
  const top = model.transcript.find(entry => entry.key === topEntryKey(rendered.layout, view, viewport));
  const day = top ? timeDisplay(top.at) : undefined;
  const title = day?.dayKey ? `Transcript · ${day.date}` : 'Transcript';
  const status = statusText({ search: env.ui.search, paused: !following, entries: model.transcript.length, above: below, newer });
  const loading = !env.data.transcripts.has(model.id) && !progress;
  const body = loading ? [[t('Loading transcript…', 'muted')]] : padded;
  return { viewport, following, status, title, lines: [...edges.above, ...body, ...edges.below] };
}

export function sessionView(env: Env): SectionView {
  const { data, ui } = env;
  const detail = ui.sessionId ? buildDetail(env) : undefined;
  if (!detail) return unavailableView;
  const { model, entries } = detail;
  const side = sessionSideWidth(env.width);
  const transcriptWidth = env.width - side - 4;
  const rendered = transcriptLines(env, model, entries, transcriptWidth);
  const { viewport, following, status, title, lines } = transcriptContent(env, model, rendered, transcriptWidth);
  return {
    length: rendered.lines.length,
    transcript: rendered.layout, transcriptRows: viewport, entries: model.transcript,
    focus: () => focusAnchor(ui.focusEntry, model.transcript, rendered.layout),
    rowAt: () => ({ sessionId: null, groupId: null }),
    idAt: () => model.id,
    render: () => h(Column, { grow: 1 },
      h(Panel, { height: 4, focused: false }, h(Lines, { lines: header(model, env.width - 4, env.phase, env.measure) })),
      h(Row, { grow: 1, gap: 1 },
        h(Panel, { title, right: status, grow: 1, focused: true, accent: following ? 'green' : 'amber' },
          h(Lines, { lines, grow: 1 })),
        ...contextPanel(model, ui.pane, { width: side, measure: env.measure }, () => memoryLines(memoryPanelViewModel({ memory: data.memory.get(model.id) ?? null, items: data.memoryItems.get(model.id) ?? [], now: env.now, review: data.memoryReviews.get(model.id), sessionNames: new Map(data.sessions.map(session => [session.id, sessionLabels(session)])) }), { width: side - 4, measure: env.measure }, ui.memoryIndex, data.memoryHistory.get(model.id))))),
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
