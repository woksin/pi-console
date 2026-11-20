import { clip, sessionViewModel, wrap, type SessionViewModel, type TranscriptLine } from '@pi-console/viewmodels';
import { Column, Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { bar, blank, fit, pressureTone, rule, split, statusParts, t } from '../view/parts.ts';
import { sidePanes } from '../state/ui.ts';
import type { Env, SectionView } from './common.ts';

const LIMITS: Record<TranscriptLine['kind'], number> = { user: 8, thinking: 2, assistant: 14, tool: 1, result: 3, diff: 12, reset: 1 };

function diffLine(text: string): Line {
  const color = text.startsWith('+') ? 'green' : text.startsWith('-') ? 'red' : text.startsWith('@') ? 'violet' : 'muted';
  return [t(text, color)];
}

/** Turns one transcript entry into display lines for a column `width` cells wide. */
export function renderEntry(entry: TranscriptLine, width: number): Line[] {
  const stamp = t(`${entry.time} `, 'faint');
  const gutter = (first: boolean) => (first ? [stamp, t(`${entry.glyph} `, entry.color, { bold: true })] : [t(' '.repeat(10)), t('  ')]);
  const body = width - 12;
  if (entry.kind === 'reset') return [[stamp, ...rule(width - 9, `reset · ${entry.text}`, 'pink').map(part => ({ ...part, bold: true }))]];
  if (entry.kind === 'tool' && entry.tool) {
    return [[stamp, t('⚙ ', 'cyan'), t(entry.tool.name, 'cyan', { bold: true }), t(' ' + clip(entry.tool.args, Math.max(4, body - entry.tool.name.length - 1)), 'muted')]];
  }
  const style = entry.kind === 'thinking' ? { color: 'faint' as const, italic: true } : entry.kind === 'result' ? { color: entry.tool?.resultKind === 'error' ? 'red' as const : 'muted' as const } : entry.kind === 'user' ? { color: 'blue' as const, bold: true } : { color: 'text' as const };
  const rows = entry.kind === 'diff' ? entry.text.split('\n').slice(0, LIMITS.diff).map(text => clip(text, body)) : wrap(entry.text, body, LIMITS[entry.kind]);
  const lines = rows.map((text, index): Line => [...gutter(index === 0), ...(entry.kind === 'diff' ? diffLine(text) : [t(text, style.color, { bold: 'bold' in style, italic: 'italic' in style })])]);
  if (entry.streaming && lines.length > 0) lines[lines.length - 1] = [...lines[lines.length - 1], t(' ▍', 'cyan')];
  if (entry.kind === 'assistant' || entry.kind === 'user') lines.push([t('')]);
  return lines;
}

let linesCache: { key: unknown; width: number; search: string; lines: Line[] } | undefined;
let modelCache: { deps: readonly unknown[]; model: SessionViewModel } | undefined;

function transcriptLines(env: Env, model: SessionViewModel, key: unknown, width: number): Line[] {
  const hit = linesCache;
  if (hit && hit.key === key && hit.width === width && hit.search === env.ui.search) return hit.lines;
  const lines = model.transcript.flatMap(entry => renderEntry(entry, width));
  linesCache = { key, width, search: env.ui.search, lines };
  return lines;
}

function header(model: SessionViewModel, width: number, phase: number): Line[] {
  return [
    split([...statusParts(model.status, phase), t('  '), t(model.title, 'text', { bold: true })], [t(`updated ${model.age} ago`, 'faint')], width),
    fit([t(`${model.role} · `, 'muted'), t(model.branch, 'violet'), t(` · ${model.model} · `, 'muted'), t(`${model.cost}`, 'text'), t('  ctx ', 'muted'), ...bar(model.context.percent, 14, pressureTone(model.context.pressure)), t(` ${String(model.context.percent)}% `, pressureTone(model.context.pressure)), t(model.context.spark.slice(-16), 'faint')], width),
  ];
}

function sideLines(model: SessionViewModel, pane: (typeof sidePanes)[number], width: number): Line[] {
  const inner = width - 4;
  const tabs: Line = sidePanes.flatMap((name): Line => [t(` ${name} `, name === pane ? 'bg' : 'muted', { background: name === pane ? 'cyan' : undefined, bold: name === pane }), t(' ')]);
  const body: Line[] = [];
  if (pane === 'requests') {
    for (const request of model.requests) {
      body.push(fit([...statusParts(request.status, 0, false), t(` ${request.originLabel}`, request.originLabel === 'Human request' ? 'blue' : 'amber'), t(` · ${request.status.label}`, request.status.color)], inner));
      body.push(...wrap(request.text, inner - 2, 2).map((text): Line => [t('  ' + text, 'text')]));
      if (request.answer) body.push(fit([t('  ✓ final: ', 'green'), t(request.answer.text, 'muted')], inner));
      if (request.partial) body.push(fit([t('  ◐ partial, not final: ', 'amber'), t(request.partial.text, 'muted')], inner));
      body.push(blank);
    }
  } else if (pane === 'questions') {
    for (const question of model.questions) body.push(fit([t(question.blocking ? '! ' : '? ', 'amber'), t(question.text, 'text')], inner), [t(`  ${question.status}${question.blocking ? ' · blocking' : ''}`, 'muted')]);
  } else if (pane === 'jobs') {
    for (const job of model.jobs) body.push(fit([...statusParts(job.status, 0, false), t(` ${job.name} `, 'text'), t(`${job.kind} ${job.exit}`, 'faint')], inner));
    for (const sub of model.subagents) body.push(fit([...statusParts(sub.status, 0, false), t(` ↳ ${sub.name}`, 'muted')], inner));
  } else {
    for (const reset of model.resets) body.push(fit([t('┃ ', 'pink'), t(`${reset.time} ${reset.kind}`, 'text')], inner), [t(`  carried ${String(reset.carried)} · interrupted ${String(reset.interrupted)}`, 'muted')]);
  }
  if (body.length === 0) body.push([t('Nothing here.', 'faint')]);
  return [tabs, blank, ...body];
}

export function sessionView(env: Env): SectionView {
  const { data, ui } = env;
  const detail = ui.sessionId ? buildDetail(env) : undefined;
  if (!detail) return { length: 0, rowAt: () => ({ sessionId: null, groupId: null }), idAt: () => null, render: () => h(Panel, { title: 'Session', focused: true, grow: 1 }, h(Lines, { lines: [[t('This session is no longer available.', 'muted')]] })) };
  const { model, entries } = detail;
  const side = env.width >= 110 ? 40 : 0;
  const transcriptWidth = env.width - side - 4;
  const lines = transcriptLines(env, model, entries, transcriptWidth);
  const viewport = Math.max(1, env.height - 4 - 3);
  const end = Math.max(0, lines.length - ui.scroll);
  const shown = lines.slice(Math.max(0, end - viewport), end);
  const padded: Line[] = [...Array.from({ length: viewport - shown.length }, () => blank), ...shown];
  const following = ui.follow && ui.scroll === 0;
  const status = ui.search ? `matching “${ui.search}” · ${String(model.transcript.length)} entries` : following ? '● following tail' : `⏸ paused · ${String(ui.scroll)} lines above live · f to follow`;
  const loading = !data.transcripts.has(model.id) && model.transcript.length === 0;
  return {
    length: lines.length,
    rowAt: () => ({ sessionId: null, groupId: null }),
    idAt: () => model.id,
    render: () => h(Column, { grow: 1 },
      h(Panel, { height: 4, focused: false }, h(Lines, { lines: header(model, env.width - 4, env.phase) })),
      h(Row, { grow: 1, gap: 1 },
        h(Panel, { title: 'Transcript', right: status, grow: 1, focused: true, accent: following ? 'green' : 'amber' },
          h(Lines, { lines: loading ? [[t('Loading transcript…', 'muted')]] : padded, grow: 1 })),
        ...(side ? [h(Panel, { title: 'Context', width: side }, h(Lines, { lines: sideLines(model, ui.pane, side) }))] : []))),
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
  if (hit && hit.deps.every((dep, index) => dep === deps[index])) return { model: hit.model, entries };
  const model = sessionViewModel({
    detail: { session, requests: own(env.data.requests), questions: own(env.data.questions), jobs: own(env.data.jobs), resets: own(env.data.resets), subagents: env.data.sessions.filter(item => item.parentSessionId === id) },
    transcript: entries, now: env.now, search: env.ui.search,
  });
  modelCache = { deps, model };
  return { model, entries };
}
